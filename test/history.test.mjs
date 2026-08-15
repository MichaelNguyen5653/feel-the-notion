/**
 * Headless regression tests for block-level undo.
 *
 * Runs CodeMirror's real state + history against the same annotation
 * dispatchBlockEdit applies, with no DOM and no Obsidian. Run with:
 *
 *   node --test test/history.test.mjs
 *
 * These cover the two ways block undo breaks:
 *   1. an operation merging with adjacent typing  -> one Cmd+Z eats both
 *   2. an operation split across two dispatches   -> needs two Cmd+Z
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Transaction } from "@codemirror/state";
import { history, undo, isolateHistory } from "@codemirror/commands";

const DOC = "first line\nsecond line\nthird line";

function makeState(doc = DOC) {
	return EditorState.create({ doc, extensions: [history()] });
}

/** Minimal stand-in for EditorView: applies transactions and tracks state. */
function makeView(doc) {
	let state = makeState(doc);
	return {
		get state() {
			return state;
		},
		dispatch(spec) {
			state = state.update(spec).state;
		},
		undo() {
			undo({ state, dispatch: (tr) => (state = tr.state) });
		},
	};
}

/** Mirrors src/history.ts — kept in sync deliberately, see note at bottom. */
function dispatchBlockEdit(view, spec) {
	const existing = spec.annotations
		? Array.isArray(spec.annotations)
			? spec.annotations
			: [spec.annotations]
		: [];
	view.dispatch({ ...spec, annotations: [isolateHistory.of("full"), ...existing] });
}

test("a block move is exactly one undo step", () => {
	const view = makeView();
	const before = view.state.doc.toString();

	// Move line 1 below line 2: delete + insert in ONE transaction.
	const line1 = view.state.doc.line(1);
	const line2 = view.state.doc.line(2);
	dispatchBlockEdit(view, {
		changes: [
			{ from: line2.to, insert: "\n" + line1.text },
			{ from: line1.from, to: line1.to + 1 },
		],
		userEvent: "move.block",
	});

	assert.notEqual(view.state.doc.toString(), before, "move should change the doc");
	view.undo();
	assert.equal(view.state.doc.toString(), before, "ONE undo should fully revert the move");
});

test("a block move does not swallow typing that preceded it", () => {
	const view = makeView();

	// Type, then immediately move a block — the case that fails without
	// isolateHistory, because history merges edits within ~500ms.
	view.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input.type" });
	const afterTyping = view.state.doc.toString();

	const line1 = view.state.doc.line(1);
	const line2 = view.state.doc.line(2);
	dispatchBlockEdit(view, {
		changes: [
			{ from: line2.to, insert: "\n" + line1.text },
			{ from: line1.from, to: line1.to + 1 },
		],
		userEvent: "move.block",
	});

	view.undo();
	assert.equal(
		view.state.doc.toString(),
		afterTyping,
		"undo should revert ONLY the move, leaving the typed X in place"
	);
});

test("footnote insert is one undo step, not two", () => {
	const view = makeView();
	const before = view.state.doc.toString();

	// Reference at the cursor AND definition at end of document, together.
	const line1 = view.state.doc.line(1);
	dispatchBlockEdit(view, {
		changes: [
			{ from: line1.to, insert: "[^42]" },
			{ from: view.state.doc.length, insert: "\n\n[^42]: " },
		],
		userEvent: "insert.block",
	});

	assert.match(view.state.doc.toString(), /\[\^42\]/);
	view.undo();
	assert.equal(
		view.state.doc.toString(),
		before,
		"ONE undo should remove both the reference and the definition"
	);
});

test("a reference never exists without its definition", () => {
	// The bug the merge fixes is not only ergonomic: with two dispatches the
	// document briefly held a footnote reference pointing at nothing.
	const view = makeView();
	const line1 = view.state.doc.line(1);

	dispatchBlockEdit(view, {
		changes: [
			{ from: line1.to, insert: "[^42]" },
			{ from: view.state.doc.length, insert: "\n\n[^42]: " },
		],
	});

	const doc = view.state.doc.toString();
	const hasRef = /\[\^42\](?!:)/.test(doc);
	const hasDef = /\[\^42\]:/.test(doc);
	assert.equal(hasRef && hasDef, true, "reference and definition must land together");
});

test("consecutive block ops are separate undo steps", () => {
	const view = makeView();
	const before = view.state.doc.toString();

	const t1 = view.state.doc.line(1);
	dispatchBlockEdit(view, {
		changes: { from: t1.from, to: t1.to, insert: "# first line" },
		userEvent: "input.block-transform",
	});
	const afterFirst = view.state.doc.toString();

	const t2 = view.state.doc.line(2);
	dispatchBlockEdit(view, {
		changes: { from: t2.from, to: t2.to, insert: "## second line" },
		userEvent: "input.block-transform",
	});

	view.undo();
	assert.equal(view.state.doc.toString(), afterFirst, "first undo reverts only the 2nd transform");
	view.undo();
	assert.equal(view.state.doc.toString(), before, "second undo reverts the 1st transform");
});

/*
 * The two tests below record what CodeMirror's history actually does, which
 * turned out NOT to match the assumption this module was built on.
 *
 * The original plan said block operations were merging with adjacent typing
 * and that isolateHistory was needed to stop it. Measured, that is false:
 * CodeMirror groups by userEvent, so a "move.block" or "input.block-transform"
 * is already separated from "input.type". isolateHistory changes nothing for
 * any case reachable through this plugin today.
 *
 * It is kept because it is free and it pins the guarantee: a future block op
 * tagged with an input.* userEvent, or left untagged, WOULD merge. The tests
 * below fail loudly if that assumption ever changes upstream.
 *
 * The bug that was actually costing two undo presses was the footnote insert
 * dispatching twice — covered above, and fixed by merging the changes into one
 * transaction rather than by any annotation.
 */

test("baseline: CodeMirror DOES merge consecutive typing into one undo step", () => {
	const view = makeView("");
	for (const ch of "abc") {
		view.dispatch({
			changes: { from: view.state.doc.length, insert: ch },
			userEvent: "input.type",
		});
	}
	assert.equal(view.state.doc.toString(), "abc");
	view.undo();
	assert.equal(view.state.doc.toString(), "", "typing groups — one undo clears all three keystrokes");
});

test("baseline: a differing userEvent already separates a block op from typing", () => {
	const view = makeView("");
	for (const ch of "abc") {
		view.dispatch({
			changes: { from: view.state.doc.length, insert: ch },
			userEvent: "input.type",
		});
	}
	// Deliberately NOT via dispatchBlockEdit — no isolation annotation.
	view.dispatch({
		changes: { from: view.state.doc.length, insert: "XYZ" },
		userEvent: "move.block",
	});

	view.undo();
	assert.equal(
		view.state.doc.toString(),
		"abc",
		"userEvent alone separates the block op; isolateHistory is insurance, not the fix"
	);
});
