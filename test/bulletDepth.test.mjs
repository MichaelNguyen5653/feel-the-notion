/**
 * Bullet depth markers, ported from MichaelNguyen5653/Bullet-Depth-Markers.
 *
 * The marker character in the FILE follows nesting depth: `-`, then `*`, then
 * `+`, cycling. The reconcile tests are carried over from that plugin's suite
 * unchanged, so the port is held to the behaviour it already shipped with.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_MARKERS,
	markerForDepth,
	planRewrites,
	applyRewrites,
	resolveBulletMarkers,
} from "./.build/bulletDepth.js";

const TAB = 4;

/** Reconcile an entire document, returning the resulting text. */
function reconcile(text, markers = DEFAULT_MARKERS, tabSize = TAB) {
	return applyRewrites(text, planRewrites(text, 0, text.length, tabSize, markers));
}

// ── markers ────────────────────────────────────────────────────────────────

test("markerForDepth maps depth 1/2/3 to - * +", () => {
	assert.equal(markerForDepth(1, DEFAULT_MARKERS), "-");
	assert.equal(markerForDepth(2, DEFAULT_MARKERS), "*");
	assert.equal(markerForDepth(3, DEFAULT_MARKERS), "+");
});

test("markerForDepth cycles at depth 4", () => {
	assert.equal(markerForDepth(4, DEFAULT_MARKERS), "-");
	assert.equal(markerForDepth(5, DEFAULT_MARKERS), "*");
});

// ── reconcile ──────────────────────────────────────────────────────────────

test("three-level list gets one marker per depth", () => {
	assert.equal(reconcile(["- A", "\t- B", "\t\t- C"].join("\n")), ["- A", "\t* B", "\t\t+ C"].join("\n"));
});

test("depth 4 cycles back to the first marker", () => {
	assert.equal(
		reconcile(["- A", "\t- B", "\t\t- C", "\t\t\t- D"].join("\n")),
		["- A", "\t* B", "\t\t+ C", "\t\t\t- D"].join("\n")
	);
});

test("ordered item keeps its numbering but occupies a depth level", () => {
	assert.equal(reconcile(["1. A", "\t- B", "\t\t- C"].join("\n")), ["1. A", "\t* B", "\t\t+ C"].join("\n"));
});

test("checkbox items are rewritten and stay checkboxes", () => {
	assert.equal(
		reconcile(["- A", "\t- [ ] T", "\t\t- [x] U"].join("\n")),
		["- A", "\t* [ ] T", "\t\t+ [x] U"].join("\n")
	);
});

test("bullets inside a fenced code block are left alone", () => {
	const input = ["- A", "\t- B", "", "```text", "\t\t- C", "```", "", "- D"].join("\n");
	const want = ["- A", "\t* B", "", "```text", "\t\t- C", "```", "", "- D"].join("\n");
	assert.equal(reconcile(input), want);
});

test("YAML frontmatter list items are left alone", () => {
	const input = ["---", "tags:", "  - one", "  - two", "---", "", "- A", "\t- B"].join("\n");
	const want = ["---", "tags:", "  - one", "  - two", "---", "", "- A", "\t* B"].join("\n");
	assert.equal(reconcile(input), want);
});

test("indent stack handles a 2-space level nested inside a 4-space level", () => {
	// Naive division by tabSize would put "- C" at depth 2 (6/4 -> 1). The stack gives 3.
	assert.equal(reconcile(["- A", "    - B", "      - C"].join("\n")), ["- A", "    * B", "      + C"].join("\n"));
});

test("spaces and tabs at the same visual column yield the same depth", () => {
	assert.equal(reconcile(["- A", "\t- B"].join("\n")), ["- A", "\t* B"].join("\n"));
	assert.equal(reconcile(["- A", "    - B"].join("\n")), ["- A", "    * B"].join("\n"));
});

test("an already-correct document produces zero changes", () => {
	// Zero changes is what stops the transaction filter recursing on its own output.
	const text = ["- A", "\t* B", "\t\t+ C", "\t\t\t- D"].join("\n");
	assert.deepEqual(planRewrites(text, 0, text.length, TAB, DEFAULT_MARKERS), []);
});

test("reconcile is idempotent", () => {
	const once = reconcile(["- A", "\t- B", "\t\t- C"].join("\n"));
	assert.equal(reconcile(once), once);
});

test("a blank line inside a loose list does not break the block", () => {
	assert.equal(reconcile(["- A", "", "\t- B"].join("\n")), ["- A", "", "\t* B"].join("\n"));
});

test("a paragraph between two lists restarts depth", () => {
	const input = ["- A", "\t- B", "", "Some paragraph.", "", "- C", "\t- D"].join("\n");
	const want = ["- A", "\t* B", "", "Some paragraph.", "", "- C", "\t* D"].join("\n");
	assert.equal(reconcile(input), want);
});

test("non-list lines are never modified", () => {
	const input = ["# Heading", "", "Plain text with - a dash.", "", "- A"].join("\n");
	assert.equal(reconcile(input), input);
});

test("a thematic break is not mistaken for a bullet", () => {
	const input = ["- A", "- - -", "- B"].join("\n");
	assert.equal(reconcile(input), input);
});

test("a custom two-marker sequence cycles every two levels", () => {
	assert.equal(reconcile(["- A", "\t- B", "\t\t- C"].join("\n"), ["-", "*"]), ["- A", "\t* B", "\t\t- C"].join("\n"));
});

test("a reordered sequence puts its first marker at depth 1", () => {
	assert.equal(reconcile(["- A", "\t- B"].join("\n"), ["+", "-", "*"]), ["+ A", "\t- B"].join("\n"));
});

test("only the list block touching the changed range is reconciled", () => {
	const text = ["- A", "\t- B", "", "Para.", "", "- C", "\t- D"].join("\n");
	const got = applyRewrites(text, planRewrites(text, text.indexOf("- C"), text.length, TAB, DEFAULT_MARKERS));
	assert.equal(got, ["- A", "\t- B", "", "Para.", "", "- C", "\t* D"].join("\n"));
});

test("every rewrite is a single character, so the caret cannot drift", () => {
	const text = ["- A", "\t- B", "\t\t- C"].join("\n");
	for (const change of planRewrites(text, 0, text.length, TAB, DEFAULT_MARKERS)) {
		assert.equal(change.to - change.from, 1);
		assert.equal(change.insert.length, 1);
	}
});

test("an empty marker sequence plans nothing", () => {
	assert.deepEqual(planRewrites("- A\n\t- B", 0, 8, TAB, []), []);
});

test("CRLF documents nest correctly", () => {
	assert.equal(reconcile(["- A", "\t- B", "\t\t- C"].join("\r\n")), ["- A", "\t* B", "\t\t+ C"].join("\r\n"));
});

test("a blank CRLF line inside a loose list does not break the block", () => {
	assert.equal(reconcile(["- A", "", "\t- B"].join("\r\n")), ["- A", "", "\t* B"].join("\r\n"));
});

test("a CRLF thematic break still ends the block", () => {
	const input = ["- A", "\t- B", "---", "- C", "\t- D"].join("\r\n");
	const want = ["- A", "\t* B", "---", "- C", "\t* D"].join("\r\n");
	assert.equal(reconcile(input), want);
});

// ── settings ───────────────────────────────────────────────────────────────

test("no stored order resolves to the default sequence", () => {
	assert.deepEqual(resolveBulletMarkers([], []), ["-", "*", "+"]);
});

test("a stored order is honoured", () => {
	assert.deepEqual(resolveBulletMarkers(["+", "*", "-"], []), ["+", "*", "-"]);
});

test("hidden markers are dropped from the sequence", () => {
	assert.deepEqual(resolveBulletMarkers(["-", "*", "+"], ["*"]), ["-", "+"]);
});

test("a marker missing from the stored order is appended, not lost", () => {
	assert.deepEqual(resolveBulletMarkers(["+"], []), ["+", "-", "*"]);
});

test("characters that are not list markers are discarded", () => {
	// Anything else written into the file stops the line parsing as a list
	// item at all, which corrupts the note rather than restyling it.
	assert.deepEqual(resolveBulletMarkers(["-", "→", "*", "1."], []), ["-", "*", "+"]);
});

test("a duplicated marker is kept once", () => {
	assert.deepEqual(resolveBulletMarkers(["*", "*", "-"], []), ["*", "-", "+"]);
});

test("hiding every marker still leaves the first one", () => {
	// Settings never allow this, but a hand-edited data.json can. An empty
	// sequence would quietly switch the feature off with no setting showing it.
	assert.deepEqual(resolveBulletMarkers(["*", "-", "+"], ["-", "*", "+"]), ["*"]);
});

// ── the editor filter ──────────────────────────────────────────────────────
//
// Run against a real EditorState rather than the pure planner, because what
// these pin is the wiring: the toggle, the empty-document guard, and the fix
// riding in the same transaction as the edit that caused it.

import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { bulletDepthExtension } from "./.build/bulletDepth.js";

function editor(doc, getMarkers = () => DEFAULT_MARKERS, extra = []) {
	return EditorState.create({ doc, extensions: [bulletDepthExtension(getMarkers), ...extra] });
}

test("indenting a bullet rewrites its marker in the same edit", () => {
	const state = editor("- A\n- B");
	const next = state.update({ changes: { from: 4, insert: "\t" } }).state;
	assert.equal(next.doc.toString(), "- A\n\t* B");
});

test("nothing is rewritten while the feature is off", () => {
	const state = editor("- A\n- B", () => null);
	const next = state.update({ changes: { from: 4, insert: "\t" } }).state;
	assert.equal(next.doc.toString(), "- A\n\t- B");
});

test("opening a note does not rewrite its existing markers", () => {
	// Loading fills an empty editor in one transaction. Treating that as an
	// edit would rewrite the whole file on open and mark it dirty.
	const state = editor("");
	const next = state.update({ changes: { from: 0, insert: "- A\n\t- B" } }).state;
	assert.equal(next.doc.toString(), "- A\n\t- B");
});

test("typing in a paragraph below a list leaves the list alone", () => {
	// The standalone plugin's README promises old notes are only fixed where
	// edited. Its planner grows an edit outward through blank lines into the
	// list next door, so typing under an old list rewrote the list.
	const state = editor("- A\n\t- B\n\nPara");
	const next = state.update({ changes: { from: 14, insert: "!" } }).state;
	assert.equal(next.doc.toString(), "- A\n\t- B\n\nPara!");
});

test("typing in a paragraph directly under a list leaves the list alone", () => {
	const state = editor("- A\n\t- B\nPara");
	const next = state.update({ changes: { from: 13, insert: "!" } }).state;
	assert.equal(next.doc.toString(), "- A\n\t- B\nPara!");
});

test("turning a parent into a paragraph re-levels its former children", () => {
	// The other side of the narrowing: this edit DOES touch the list, so the
	// grandchild that is now first in its own list must become depth 1.
	const state = editor("- A\n\t* C\n\t\t+ D");
	const next = state.update({ changes: { from: 4, to: 7 } }).state;
	assert.equal(next.doc.toString(), "- A\nC\n\t\t- D");
});

test("one undo reverses both the indent and the marker fix", () => {
	const state = editor("- A\n- B", () => DEFAULT_MARKERS, [history()]);
	let current = state.update({ changes: { from: 4, insert: "\t" } }).state;
	assert.equal(current.doc.toString(), "- A\n\t* B");

	undo({ state: current, dispatch: (tr) => { current = tr.state; } });
	assert.equal(current.doc.toString(), "- A\n- B");
});
