/**
 * Tests for the insert arithmetic, asserting on resulting document TEXT and on
 * where the caret lands.
 *
 * The slash menu deletes the typed `/query` in the same transaction as the
 * insert. That shifts every offset after it, and getting it wrong by one
 * character does not throw — it just leaves the caret in the wrong place or a
 * fragment of the query in the note.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planInsert } from "./.build/insertPlan.js";
import { applyChanges } from "./.build/planMove.js";

/** Applies a plan to a single-line document and reports text plus caret. */
function run(lineText, input) {
	const plan = planInsert({
		lineFrom: 0,
		lineTo: lineText.length,
		lineText,
		...input,
	});
	return { text: applyChanges(lineText, plan.changes), anchor: plan.anchor };
}

// ── plain inserts, unchanged behaviour ─────────────────────────────────────

test("a block insert on an empty line stays on that line", () => {
	const out = run("", { insertText: "# ", asBlock: true });
	assert.equal(out.text, "# ");
	assert.equal(out.anchor, 2, "caret after the marker, ready to type");
});

test("a block insert on a line with content opens a new line", () => {
	const out = run("alpha", { insertText: "# ", asBlock: true });
	assert.equal(out.text, "alpha\n# ");
	assert.equal(out.anchor, 8);
});

test("an inline insert never opens a new line", () => {
	const out = run("alpha", { insertText: "[[]]", cursorOffset: 2, asBlock: false });
	assert.equal(out.text, "alpha[[]]");
	assert.equal(out.anchor, 7, "caret between the brackets");
});

test("cursorOffset places the caret inside the inserted text", () => {
	const out = run("", { insertText: "```\n\n```", cursorOffset: 4, asBlock: true });
	assert.equal(out.text, "```\n\n```");
	assert.equal(out.anchor, 4);
});

// ── removing the slash query ───────────────────────────────────────────────

test("the typed query is deleted by the insert itself", () => {
	const out = run("/head", {
		insertText: "# ",
		asBlock: true,
		remove: { from: 0, to: 5 },
	});
	assert.equal(out.text, "# ", "no trace of the query survives");
	assert.equal(out.anchor, 2);
});

test("a line holding only the query counts as empty, so no new line opens", () => {
	// The judgement has to happen AFTER the removal. Judging the line as it
	// stands would see "/head", decide the line has content, and push the
	// heading onto a new line below an empty one.
	const out = run("/", { insertText: "- ", asBlock: true, remove: { from: 0, to: 1 } });
	assert.equal(out.text, "- ");
});

test("indentation is kept when the query is removed", () => {
	const out = run("\t/h1", {
		insertText: "# ",
		asBlock: true,
		remove: { from: 1, to: 4 },
	});
	assert.equal(out.text, "\t# ", "an empty nested block keeps its depth");
	assert.equal(out.anchor, 3, "caret at the end of the line");
});

test("removal and insertion never overlap", () => {
	// CodeMirror throws outright on overlapping changes.
	const plan = planInsert({
		lineFrom: 0,
		lineTo: 5,
		lineText: "/head",
		insertText: "# ",
		asBlock: true,
		remove: { from: 0, to: 5 },
	});
	const sorted = [...plan.changes].sort((a, b) => a.from - b.from);
	for (let i = 1; i < sorted.length; i++) {
		const prevEnd = sorted[i - 1].to ?? sorted[i - 1].from;
		assert.ok(sorted[i].from >= prevEnd, "changes must not overlap");
	}
});

// ── the awkward cases ──────────────────────────────────────────────────────

test("changes elsewhere in the document ride along", () => {
	// The footnote definition, appended at the end. It is carried in the same
	// transaction so one insert costs one undo press.
	const out = run("alpha", {
		insertText: "[^1]",
		asBlock: false,
		extra: [{ from: 5, insert: "\n\n[^1]: " }],
	});
	assert.equal(out.text, "alpha[^1]\n\n[^1]: ");
});

test("an insertion point inside the removed span moves clear of it", () => {
	// Frontmatter inserts at offset zero regardless of where the caret is. If
	// the query being removed also starts at zero, inserting there would be an
	// overlap and CodeMirror would throw.
	const out = run("/meta", {
		insertText: "---\n\n---\n",
		cursorOffset: 4,
		asBlock: false,
		at: 0,
		remove: { from: 0, to: 5 },
	});
	assert.equal(out.text, "---\n\n---\n");
	assert.equal(out.anchor, 4, "caret on the blank line between the fences");
});

test("an empty removal range is dropped rather than emitted", () => {
	const plan = planInsert({
		lineFrom: 0,
		lineTo: 0,
		lineText: "",
		insertText: "# ",
		asBlock: true,
		remove: { from: 0, to: 0 },
	});
	assert.equal(plan.changes.length, 1);
});
