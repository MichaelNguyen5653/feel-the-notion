/**
 * Tests for when the slash menu opens, what it filters on, and when it gives up.
 *
 * The trigger rule matters more than it looks: "/" is a common character in
 * prose, dates and URLs, so a rule that fires too readily would put a menu over
 * text the user is in the middle of writing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	isSlashTriggerPosition,
	matchesQuery,
	normaliseTrigger,
	readSlashQuery,
} from "./.build/slashTrigger.js";

// ── when it opens ──────────────────────────────────────────────────────────

test("an empty block opens the menu", () => {
	assert.equal(isSlashTriggerPosition(""), true);
});

test("indentation does not count as content", () => {
	// An empty nested bullet is still an empty block.
	assert.equal(isSlashTriggerPosition("\t"), true);
	assert.equal(isSlashTriggerPosition("    "), true);
});

test("a slash mid-sentence is left alone", () => {
	for (const before of ["and", "and ", "https:/", "24", "- item "]) {
		assert.equal(
			isSlashTriggerPosition(before),
			false,
			`${JSON.stringify(before)} should not open the menu`
		);
	}
});

// ── inline triggering ──────────────────────────────────────────────────────

test("inline mode opens the menu after a space", () => {
	assert.equal(isSlashTriggerPosition("write a note ", true), true);
	assert.equal(isSlashTriggerPosition("- a bullet with text ", true), true);
});

test("inline mode still leaves prose, URLs and dates alone", () => {
	// The guard is a space in front of the trigger, which is what keeps every
	// slash people actually type quiet.
	for (const before of ["and", "https:/", "12", "path/to"]) {
		assert.equal(isSlashTriggerPosition(before, true), false, before);
	}
});

test("an empty callout or list line counts as an empty block", () => {
	// Reported: a table of contents could not be added inside an `> [!info]`
	// block because the trigger never fired on its empty body line.
	for (const before of ["> ", "> > ", "  > ", "- ", "- [ ] ", "1. ", "    - "]) {
		assert.equal(isSlashTriggerPosition(before), true, JSON.stringify(before));
	}
});

test("a callout's own title line is content, not a bare marker", () => {
	assert.equal(isSlashTriggerPosition("> [!info] "), false);
	assert.equal(isSlashTriggerPosition("- a bullet "), false);
});

test("inline mode does not change the empty-block rule", () => {
	assert.equal(isSlashTriggerPosition("", true), true);
	assert.equal(isSlashTriggerPosition("    - ", true), true);
});

test("inline mode off keeps the trigger to empty blocks", () => {
	assert.equal(isSlashTriggerPosition("write a note ", false), false);
	assert.equal(isSlashTriggerPosition("write a note "), false, "defaults to off");
});

// ── the query ──────────────────────────────────────────────────────────────

test("the query is everything typed after the trigger", () => {
	assert.equal(readSlashQuery("/head", 0, 5, "/"), "head");
	assert.equal(readSlashQuery("/", 0, 1, "/"), "");
});

test("the query survives spaces", () => {
	// "heading 1" is a reasonable thing to type, so a space must not close it.
	assert.equal(readSlashQuery("/heading 1", 0, 10, "/"), "heading 1");
});

test("a caret back at or before the trigger closes the menu", () => {
	assert.equal(readSlashQuery("/head", 0, 0, "/"), null);
	assert.equal(readSlashQuery("x/head", 1, 1, "/"), null);
});

test("deleting the trigger closes the menu", () => {
	// The user backspaced over the "/" itself; there is no session left.
	assert.equal(readSlashQuery("head", 0, 4, "/"), null);
});

test("the query is read from the trigger's column, not the line start", () => {
	assert.equal(readSlashQuery("\t/h1", 1, 4, "/"), "h1");
});

// ── filtering ──────────────────────────────────────────────────────────────

test("an empty query matches everything", () => {
	assert.equal(matchesQuery("", "Heading 1"), true);
	assert.equal(matchesQuery("   ", "Heading 1"), true);
});

test("labels match on any substring, case-insensitively", () => {
	assert.equal(matchesQuery("head", "Heading 1"), true);
	assert.equal(matchesQuery("HEAD", "Heading 1"), true);
	assert.equal(matchesQuery("ding", "Heading 1"), true);
	assert.equal(matchesQuery("table", "Heading 1"), false);
});

test("keywords catch the shorthand people actually type", () => {
	// "h1" is not a substring of "Heading 1", and it is what gets typed.
	assert.equal(matchesQuery("h1", "Heading 1"), false);
	assert.equal(matchesQuery("h1", "Heading 1", ["h1"]), true);
	assert.equal(matchesQuery("pdf", "Insert attachment", ["file", "pdf"]), true);
});

// ── the configured trigger ─────────────────────────────────────────────────

test("the trigger is reduced to a single character", () => {
	assert.equal(normaliseTrigger("/"), "/");
	assert.equal(normaliseTrigger(";;"), ";");
	assert.equal(normaliseTrigger(" / "), "/");
});

test("an unset trigger disables the menu rather than matching everything", () => {
	assert.equal(normaliseTrigger(""), null);
	assert.equal(normaliseTrigger("   "), null);
	assert.equal(normaliseTrigger(undefined), null);
});
