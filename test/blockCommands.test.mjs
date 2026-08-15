/**
 * Tests for Cmd+A escalation and Backspace at a block's start.
 *
 * Both commands are mostly about knowing when NOT to act: they return null
 * wherever the editor's own behaviour is already right, and a plan that fires
 * too eagerly is worse than no plan at all — it would break ordinary typing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { blockMarker, planBackspace, planSelectAll } from "./.build/blockCommands.js";
import { applyChanges } from "./.build/planMove.js";

const docOf = (text) => EditorState.create({ doc: text }).doc;

/** Runs Backspace at `pos` and returns the resulting document text. */
function backspace(text, pos, unit = 4) {
	const plan = planBackspace(docOf(text), pos, unit);
	if (!plan) return null;
	return applyChanges(text, plan.changes);
}

// ── marker detection ───────────────────────────────────────────────────────

test("blockMarker matches the task pattern before the bullet pattern", () => {
	// "- [ ] x" matches both. Stripping only "- " would leave a stray "[ ]".
	assert.equal(blockMarker("- [ ] task"), "- [ ] ");
	assert.equal(blockMarker("- item"), "- ");
	assert.equal(blockMarker("1. item"), "1. ");
	assert.equal(blockMarker("### head"), "### ");
	assert.equal(blockMarker("> quote"), "> ");
	assert.equal(blockMarker("plain text"), "");
	assert.equal(blockMarker("2 * 3"), "");
});

// ── Backspace: leave ordinary editing alone ────────────────────────────────

test("mid-line Backspace is left to the editor", () => {
	assert.equal(backspace("- item", 4), null);
	assert.equal(backspace("plain text", 5), null);
});

test("Backspace at the very start of the document does nothing", () => {
	assert.equal(backspace("alpha\nbravo", 0), null);
});

test("joining two adjacent lines is left to the editor", () => {
	// Deleting the single newline between them already merges the blocks.
	assert.equal(backspace("- alpha\nbravo", 8), null);
});

// ── Backspace: drop the marker ─────────────────────────────────────────────

test("Backspace at a bullet's text start drops the bullet", () => {
	assert.equal(backspace("- item", 2), "item");
});

test("Backspace before a hidden marker drops it too", () => {
	// With syntax markers hidden the caret lands at column zero, not after the
	// marker, so both offsets have to behave the same way.
	assert.equal(backspace("- item", 0), "item");
});

test("Backspace drops a whole task marker, not half of it", () => {
	assert.equal(backspace("- [ ] task", 6), "task");
});

test("Backspace turns a heading into plain text", () => {
	assert.equal(backspace("## Heading", 3), "Heading");
});

test("Backspace drops a quote marker", () => {
	assert.equal(backspace("> quoted", 2), "quoted");
});

test("the caret lands where the text now starts", () => {
	const plan = planBackspace(docOf("### Heading"), 4, 4);
	assert.equal(plan.anchor, 0);
});

// ── Backspace: outdent first ───────────────────────────────────────────────

test("an indented item steps out one level before losing its bullet", () => {
	assert.equal(backspace("\t- item", 3), "- item");
});

test("outdent removes one indent unit, not the whole indent", () => {
	assert.equal(backspace("        - deep", 10, 4), "    - deep");
});

test("outdent works from the absolute start of an indented line", () => {
	assert.equal(backspace("\t- item", 0), "- item");
});

test("indented prose outdents as well", () => {
	assert.equal(backspace("    continuation", 4, 4), "continuation");
});

// ── Backspace: merge across a blank line ───────────────────────────────────

test("Backspace across a blank separator merges the two blocks", () => {
	// The editor's own Backspace deletes one newline, which leaves a soft break
	// inside one paragraph — a merge in the file that is not a merge on screen.
	assert.equal(backspace("alpha\n\nbravo", 7), "alphabravo");
});

test("merging across several blank lines closes all of them", () => {
	assert.equal(backspace("alpha\n\n\n\nbravo", 9), "alphabravo");
});

test("Backspace under nothing but blank lines does nothing", () => {
	assert.equal(backspace("\n\nbravo", 2), null);
});

// ── Cmd+A escalation ───────────────────────────────────────────────────────

const DOC = ["para one line A", "para one line B", "", "- item", "\t- child"].join("\n");

test("Cmd+A with a caret selects the block it is in", () => {
	const doc = docOf(DOC);
	const plan = planSelectAll(doc, EditorSelection.cursor(3));
	assert.deepEqual(plan, { from: 0, to: 31 }, "both lines of the wrapped paragraph");
});

test("Cmd+A over a partial selection still selects the block first", () => {
	const doc = docOf(DOC);
	const plan = planSelectAll(doc, EditorSelection.range(2, 6));
	assert.deepEqual(plan, { from: 0, to: 31 });
});

test("Cmd+A on a whole block escalates to the document", () => {
	const doc = docOf(DOC);
	const plan = planSelectAll(doc, EditorSelection.range(0, 31));
	assert.deepEqual(plan, { from: 0, to: doc.length });
});

test("Cmd+A across blocks escalates to the document", () => {
	const doc = docOf(DOC);
	const plan = planSelectAll(doc, EditorSelection.range(3, 35));
	assert.deepEqual(plan, { from: 0, to: doc.length });
});

test("Cmd+A on the whole document defers to the default command", () => {
	const doc = docOf(DOC);
	assert.equal(planSelectAll(doc, EditorSelection.range(0, doc.length)), null);
});

test("Cmd+A on an empty block escalates rather than selecting nothing", () => {
	// A zero-width block range would leave the selection empty, so the next
	// press would compute the same empty range and Cmd+A would never escalate.
	const doc = docOf(DOC);
	const blankLine = doc.line(3);
	const plan = planSelectAll(doc, EditorSelection.cursor(blankLine.from));
	assert.deepEqual(plan, { from: 0, to: doc.length });
});

test("Cmd+A inside a nested item takes the item and its children", () => {
	const doc = docOf(DOC);
	const parent = doc.line(4);
	const plan = planSelectAll(doc, EditorSelection.cursor(parent.from + 3));
	assert.equal(plan.from, parent.from);
	assert.equal(plan.to, doc.line(5).to, "the child travels with it, as in a drag");
});

// ── Cmd+A inside a code block ──────────────────────────────────────────────

const CODE = [
	"intro", // 1
	"```js", // 2
	"# not a heading", // 3
	"", // 4
	"- not a bullet", // 5
	"```", // 6
	"after", // 7
];

test("Cmd+A in a code block selects the code, fences excluded", () => {
	// Without this the markdown walk reads the code as markdown: the "#" line
	// looks like a heading and the "-" line like a list item, so the selection
	// landed on whichever line happened to resemble a marker.
	const doc = docOf(CODE.join("\n"));
	const plan = planSelectAll(doc, EditorSelection.cursor(doc.line(3).from + 2));
	assert.equal(
		doc.sliceString(plan.from, plan.to),
		"# not a heading\n\n- not a bullet"
	);
});

test("a blank line inside a code block does not split it", () => {
	const doc = docOf(CODE.join("\n"));
	const plan = planSelectAll(doc, EditorSelection.cursor(doc.line(4).from));
	assert.ok(plan.to - plan.from > 20, "the whole block, not the blank line");
});

test("Cmd+A from any line of a code block selects the same code", () => {
	const doc = docOf(CODE.join("\n"));
	const expected = planSelectAll(doc, EditorSelection.cursor(doc.line(3).from));
	for (const line of [2, 4, 5, 6]) {
		assert.deepEqual(
			planSelectAll(doc, EditorSelection.cursor(doc.line(line).from)),
			expected,
			`from line ${line}`
		);
	}
});

test("Cmd+A again escalates from the code to the document", () => {
	const doc = docOf(CODE.join("\n"));
	const code = planSelectAll(doc, EditorSelection.cursor(doc.line(3).from));
	const next = planSelectAll(doc, EditorSelection.range(code.from, code.to));
	assert.deepEqual(next, { from: 0, to: doc.length });
});

test("Cmd+A in an empty code block escalates rather than selecting nothing", () => {
	const doc = docOf(["```", "```", "after"].join("\n"));
	const plan = planSelectAll(doc, EditorSelection.cursor(doc.line(2).from));
	assert.deepEqual(plan, { from: 0, to: doc.length });
});

test("prose outside the fence is unaffected", () => {
	const doc = docOf(CODE.join("\n"));
	const plan = planSelectAll(doc, EditorSelection.cursor(doc.line(7).from));
	assert.deepEqual([plan.from, plan.to], [doc.line(7).from, doc.line(7).to]);
});
