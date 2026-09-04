/**
 * End-to-end drag tests: given a document and a drag, assert the resulting
 * document TEXT.
 *
 * These exist because the earlier bugs were not crashes — a block quietly
 * carried two extra paragraphs with it, or left a stray blank line behind.
 * Asserting on ranges missed both. Asserting on the finished document does not.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { resolveDragRange } from "./.build/dragRange.js";
import { planBlockMove, applyChanges } from "./.build/planMove.js";

/** Simulates a full drag: grab `fromLine`, drop before `toLine` at `indent`. */
function drag(lines, fromLine, toLine, indent = null) {
	const text = lines.join("\n");
	const doc = EditorState.create({ doc: text }).doc;
	const range = resolveDragRange(doc, fromLine, "paragraph");
	const source = {
		from: range.from,
		to: range.to,
		text: doc.sliceString(range.from, range.to),
		indent: range.indent,
		firstLine: range.firstLine,
		lastLine: range.lastLine,
	};
	const changes = planBlockMove(doc, source, toLine, indent ?? range.indent);
	return applyChanges(text, changes).split("\n");
}

// ── the reported scenario ──────────────────────────────────────────────────

const REPORTED = [
	"- The shirt is white", // 1
	"The score is now 1-1", // 2
	"bob's furniture", // 3
	"- I think", // 4
	"\t- The score is 1 - 0", // 5
];

test("dragging a list item does not carry the paragraphs below it", () => {
	// The reported bug: grabbing "The shirt is white" took the two plain
	// paragraphs under it, scattering blocks the user never touched.
	const doc = EditorState.create({ doc: REPORTED.join("\n") }).doc;
	const r = resolveDragRange(doc, 1, "paragraph");
	assert.deepEqual(
		[r.firstLine, r.lastLine],
		[1, 1],
		"a list item at column zero owns only what is indented under it"
	);
});

test("the reported drag leaves the untouched paragraphs in place", () => {
	const out = drag(REPORTED, 1, 6, 4);
	assert.ok(out.includes("The score is now 1-1"), "paragraph must survive");
	assert.ok(out.includes("bob's furniture"), "paragraph must survive");
	assert.equal(out.indexOf("The score is now 1-1"), 0, "and stay at the top, where it was");
});

test("the reported drag introduces no blank lines", () => {
	// The gap visible in the reported screenshots.
	const before = REPORTED.filter((l) => l.trim() === "").length;
	const after = drag(REPORTED, 1, 6, 4).filter((l) => l.trim() === "").length;
	assert.equal(after, before, "a move must not invent blank lines");
});

test("the reported drag preserves every line exactly once", () => {
	const out = drag(REPORTED, 1, 6, 4);
	assert.equal(out.length, REPORTED.length, "no lines gained or lost");
	for (const line of REPORTED) {
		const count = out.filter((l) => l.trim() === line.trim()).length;
		assert.equal(count, 1, `${JSON.stringify(line)} should appear exactly once`);
	}
});

// ── newline handling ───────────────────────────────────────────────────────

const SIMPLE = ["alpha", "", "bravo", "", "charlie"];

test("moving a block down keeps the line count", () => {
	const out = drag(SIMPLE, 1, 5);
	assert.equal(out.length, SIMPLE.length);
});

test("moving a block up keeps the line count", () => {
	const out = drag(SIMPLE, 5, 1);
	assert.equal(out.length, SIMPLE.length);
	assert.equal(out[0], "charlie");
});

// NOTE: consecutive prose lines with no blank between them are ONE paragraph,
// so these use list items to get genuinely separate blocks.

test("moving the LAST block leaves no trailing blank line", () => {
	// End-of-document case: there is no trailing newline to remove, so the
	// preceding one must go instead or the document keeps a hole.
	const out = drag(["- alpha", "- bravo", "- charlie"], 3, 1);
	assert.deepEqual(out, ["- charlie", "- alpha", "- bravo"]);
});

test("moving a block to the very end leaves no hole behind", () => {
	const out = drag(["- alpha", "- bravo", "- charlie"], 1, 4);
	assert.deepEqual(out, ["- bravo", "- charlie", "- alpha"]);
});

test("dropping a block onto its own position changes nothing", () => {
	// Both bounds matter. Dropping at the block's own first line used to emit
	// an insert and a delete starting at the same offset — overlapping changes,
	// which CodeMirror rejects outright.
	for (const target of [1, 2]) {
		assert.deepEqual(
			drag(["- alpha", "- bravo"], 1, target),
			["- alpha", "- bravo"],
			`dropping block 1 before line ${target} should be a no-op`
		);
	}
});

test("planned changes never overlap", () => {
	// CodeMirror throws on overlapping changes, so this is a crash guard.
	const lines = ["- a", "- b", "- c", "- d"];
	const text = lines.join("\n");
	const doc = EditorState.create({ doc: text }).doc;

	for (let from = 1; from <= lines.length; from++) {
		const range = resolveDragRange(doc, from, "paragraph");
		const source = {
			from: range.from,
			to: range.to,
			text: doc.sliceString(range.from, range.to),
			indent: range.indent,
			firstLine: range.firstLine,
			lastLine: range.lastLine,
		};
		for (let to = 1; to <= lines.length + 1; to++) {
			const changes = planBlockMove(doc, source, to, range.indent);
			const sorted = [...changes].sort((a, b) => a.from - b.from);
			for (let i = 1; i < sorted.length; i++) {
				const prevEnd = sorted[i - 1].to ?? sorted[i - 1].from;
				assert.ok(
					sorted[i].from >= prevEnd,
					`drag ${from} -> ${to} produced overlapping changes`
				);
			}
		}
	}
});

// ── nesting survives the move ──────────────────────────────────────────────

const NESTED = [
	"- parent", // 1
	"\t- child", // 2
	"- other", // 3
];

test("a parent carries its child and keeps the nesting", () => {
	const out = drag(NESTED, 1, 4);
	assert.equal(out.filter((l) => l.includes("child")).length, 1, "child moved once");
	const parentAt = out.findIndex((l) => l.includes("parent"));
	const childAt = out.findIndex((l) => l.includes("child"));
	assert.equal(childAt, parentAt + 1, "child must stay directly under its parent");
});

test("re-indenting on drop shifts the whole subtree together", () => {
	const out = drag(NESTED, 1, 4, 4);
	const parent = out.find((l) => l.includes("parent"));
	const child = out.find((l) => l.includes("child"));
	assert.ok(parent.startsWith("    "), "parent moved one level deeper");
	assert.ok(
		child.startsWith("        ") || child.startsWith("    \t"),
		`child must stay deeper than parent, got ${JSON.stringify(child)}`
	);
});

test("no move ever duplicates or drops content", () => {
	// Property check across every from/to pair in a mixed document.
	const lines = ["- a", "\t- a2", "plain one", "plain two", "- b", "# H"];
	const normalise = (arr) =>
		arr
			.map((l) => l.trim())
			.filter(Boolean)
			.sort();
	const expected = normalise(lines);

	for (let from = 1; from <= lines.length; from++) {
		for (let to = 1; to <= lines.length + 1; to++) {
			const out = drag(lines, from, to);
			assert.deepEqual(
				normalise(out),
				expected,
				`drag ${from} -> ${to} changed the set of lines`
			);
		}
	}
});

/**
 * Code blocks move whole.
 *
 * The reported symptom: grab the handle and the content moves first, then the
 * code block extends rather than moves. That is one line travelling on its
 * own — the opening fence left its code behind, and the surviving markers
 * stretched over whatever text now sat between them.
 */

const FENCED = [
	"intro", // 1
	"```js", // 2
	"const x = 1;", // 3
	"```", // 4
	"after", // 5
];

test("dragging a code block by its opening fence carries the code", () => {
	assert.deepEqual(drag(FENCED, 2, 6), [
		"intro",
		"after",
		"```js",
		"const x = 1;",
		"```",
	]);
});

test("dragging a code block by a line of its code moves the whole block", () => {
	assert.deepEqual(drag(FENCED, 3, 1), [
		"```js",
		"const x = 1;",
		"```",
		"intro",
		"after",
	]);
});

test("dragging a code block by its closing fence moves the whole block", () => {
	assert.deepEqual(drag(FENCED, 4, 1), [
		"```js",
		"const x = 1;",
		"```",
		"intro",
		"after",
	]);
});

test("an unclosed code block moves whole", () => {
	// Half-typed code is the normal state of a fence being written.
	assert.deepEqual(drag(["intro", "```", "code"], 2, 1), ["```", "code", "intro"]);
});

test("prose sitting under a code block still moves on its own", () => {
	// The fence rule must not leak onto the line after the closing marker.
	assert.deepEqual(drag(FENCED, 5, 1), [
		"after",
		"intro",
		"```js",
		"const x = 1;",
		"```",
	]);
});

test("an indented code block keeps its own indent when moved", () => {
	assert.deepEqual(
		drag(["- item", "  ```", "  code", "  ```", "- other"], 2, 6),
		["- item", "- other", "  ```", "  code", "  ```"]
	);
});
