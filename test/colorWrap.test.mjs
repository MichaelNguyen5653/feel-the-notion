/**
 * Tests for colouring a line, and for where the caret lands afterwards.
 *
 * The reported bug: colouring an empty block wrote a span with nothing between
 * its tags. Live Preview renders inline HTML, an empty span renders as nothing,
 * and the block disappeared — coloured, but impossible to find or type into.
 * So every test here asserts the caret as well as the text.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planColorWrap, splitMarkdownLine } from "./.build/colorWrap.js";

const BLUE = "color: var(--color-blue);";
const OPEN = `<span style="${BLUE}">`;

/** The text either side of the caret, which is what the user actually sees. */
function atCaret(plan) {
	return [plan.text.slice(0, plan.caretOffset), plan.text.slice(plan.caretOffset)];
}

// ── the reported case ──────────────────────────────────────────────────────

test("colouring an empty line leaves the caret between the tags", () => {
	const plan = planColorWrap("", "span", BLUE);
	assert.equal(plan.text, `${OPEN}</span>`);
	assert.deepEqual(atCaret(plan), [OPEN, "</span>"], "typing here goes inside the span");
});

test("colouring a whitespace-only line behaves the same", () => {
	const plan = planColorWrap("   ", "span", BLUE);
	assert.deepEqual(atCaret(plan), [OPEN, "</span>"]);
});

// ── lines with content ─────────────────────────────────────────────────────

test("existing text is wrapped and the caret follows it", () => {
	const plan = planColorWrap("hello", "span", BLUE);
	assert.equal(plan.text, `${OPEN}hello</span>`);
	assert.deepEqual(atCaret(plan), [`${OPEN}hello`, "</span>"], "caret stays inside");
});

test("a second colour replaces the first rather than nesting", () => {
	const red = "color: var(--color-red);";
	const plan = planColorWrap(`${OPEN}hello</span>`, "span", red);
	assert.equal(plan.text, `<span style="${red}">hello</span>`);
});

test("the default colour unwraps and puts the caret after the text", () => {
	const plan = planColorWrap(`${OPEN}hello</span>`, "", "");
	assert.equal(plan.text, "hello");
	assert.equal(plan.caretOffset, 5);
});

test("a background colour uses mark and still lands the caret inside", () => {
	const bg = "background-color: rgba(0,0,0,0.1); color: inherit;";
	const plan = planColorWrap("", "mark", bg);
	assert.deepEqual(atCaret(plan), [`<mark style="${bg}">`, "</mark>"]);
});

// ── markers and block ids survive ──────────────────────────────────────────

test("a list marker stays outside the span", () => {
	const plan = planColorWrap("- item", "span", BLUE);
	assert.equal(plan.text, `- ${OPEN}item</span>`);
	assert.deepEqual(atCaret(plan), [`- ${OPEN}item`, "</span>"]);
});

test("an empty list item keeps its bullet and takes the caret inside", () => {
	const plan = planColorWrap("- ", "span", BLUE);
	assert.equal(plan.text, `- ${OPEN}</span>`);
	assert.deepEqual(atCaret(plan), [`- ${OPEN}`, "</span>"]);
});

test("a heading marker stays outside the span", () => {
	const plan = planColorWrap("## Title", "span", BLUE);
	assert.equal(plan.text, `## ${OPEN}Title</span>`);
});

test("a block id stays at the end of the line, after the closing tag", () => {
	const plan = planColorWrap("hello ^abc123", "span", BLUE);
	assert.equal(plan.text, `${OPEN}hello</span> ^abc123`);
	assert.deepEqual(atCaret(plan), [`${OPEN}hello`, "</span> ^abc123"], "caret before the id");
});

test("a task marker stays outside the span", () => {
	const plan = planColorWrap("- [ ] task", "span", BLUE);
	assert.equal(plan.text, `- [ ] ${OPEN}task</span>`);
});

// ── the splitter ───────────────────────────────────────────────────────────

test("splitMarkdownLine separates marker, content and block id", () => {
	assert.deepEqual(splitMarkdownLine("- [x] done ^id-1"), {
		prefix: "- [x] ",
		content: "done",
		suffix: " ^id-1",
	});
});

test("a plain line is all content", () => {
	assert.deepEqual(splitMarkdownLine("plain"), { prefix: "", content: "plain", suffix: "" });
});
