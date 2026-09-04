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

// ── inline triggering: the insert lands at the trigger, not at line end ─────

test("an inline insert mid-line lands where the trigger was", () => {
	// The bug allowing the menu to open mid-line introduced: the insert went
	// to the end of the line, past text the user had already typed after the
	// caret. "note /today and more" put the date after "more".
	const out = run("note /today and more", {
		insertText: "2026-08-17",
		asBlock: false,
		remove: { from: 5, to: 11 },
	});
	assert.equal(out.text, "note 2026-08-17 and more");
	assert.equal(out.anchor, 15, "caret sits after the inserted text");
});

test("a block insert mid-line still goes to the end of the line", () => {
	// Splicing a heading into the middle of a sentence would cut it in half.
	const out = run("note /h1 and more", {
		insertText: "# ",
		asBlock: true,
		remove: { from: 5, to: 8 },
	});
	assert.equal(out.text, "note  and more\n# ");
});

test("an inline insert with no removal still goes to the end of the line", () => {
	const out = run("hello", { insertText: "!", asBlock: false });
	assert.equal(out.text, "hello!");
});

test("an inline insert at the end of the line is unaffected", () => {
	// The common case, and the one that worked before: the trigger IS the tail
	// of the line, so trigger position and line end are the same place.
	const out = run("note /today", {
		insertText: "2026-08-17",
		asBlock: false,
		remove: { from: 5, to: 11 },
	});
	assert.equal(out.text, "note 2026-08-17");
	assert.equal(out.anchor, 15);
});

// ── needsBlankLine: a table dropped without a blank line above it renders as
// literal pipe-and-dash text instead of a table ──────────────────────────────

const TABLE = "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";

test("a table under a line with content gets a full blank line, not just a new line", () => {
	// One "\n" (the old asBlock behaviour) puts the table directly under the
	// paragraph: "alpha\n| | |" still renders as text under GFM rules. It takes
	// a second newline to leave an actual blank line.
	const out = run("alpha", {
		insertText: TABLE,
		asBlock: true,
		cursorOffset: 2,
		needsBlankLine: true,
		previousLineHasContent: false,
	});
	assert.equal(out.text, "alpha\n\n" + TABLE);
	assert.equal(out.anchor, 9, "caret inside the first header cell, after two newlines");
});

test("a table on an empty line under a paragraph still needs a blank line inserted", () => {
	// asBlock alone sees an empty current line and opens no new line at all, so
	// the table would land directly under the line above with nothing between
	// them. previousLineHasContent is what catches this — needsNewLine can't,
	// since it only looks at the current line.
	const out = run("", {
		insertText: TABLE,
		asBlock: true,
		cursorOffset: 2,
		needsBlankLine: true,
		previousLineHasContent: true,
	});
	assert.equal(out.text, "\n" + TABLE);
	assert.equal(out.anchor, 3);
});

test("a table on an empty line under an already-blank line does not gain a stray blank line", () => {
	// Regression guard: previousLineHasContent false must produce the same
	// empty prefix as before this feature existed, not an unwanted extra "\n"
	// above a table that already had proper separation.
	const out = run("", {
		insertText: TABLE,
		asBlock: true,
		cursorOffset: 2,
		needsBlankLine: true,
		previousLineHasContent: false,
	});
	assert.equal(out.text, TABLE);
	assert.equal(out.anchor, 2);
});

test("needsBlankLine unset leaves block inserts byte-identical to before this feature", () => {
	// Every other block type (heading, callout, code, ...) never sets
	// needsBlankLine, so it must fall back to exactly the old single-"\n"
	// behaviour with no change in text or caret.
	const out = run("alpha", { insertText: "# ", asBlock: true });
	assert.equal(out.text, "alpha\n# ");
	assert.equal(out.anchor, 8);
});
