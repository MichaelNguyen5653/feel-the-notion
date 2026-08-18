/**
 * Tests for the table of contents.
 *
 * The failure modes worth guarding: headings inside code fences, a note whose
 * top level is not H1, heading text containing the characters a link cannot
 * carry, and the command listing its own trigger line.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
	collectHeadings,
	headingAnchor,
	prefixLines,
	quotePrefix,
	tableOfContents,
} from "./.build/tableOfContents.js";

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const tocOf = (lines, skipLine) => tableOfContents(collectHeadings(docOf(lines), skipLine));
const titledTocOf = (lines) =>
	tableOfContents(collectHeadings(docOf(lines)), { title: "Table of contents" });

// ── collecting ─────────────────────────────────────────────────────────────

test("headings are collected in document order with their levels", () => {
	const headings = collectHeadings(docOf(["# One", "text", "### Three", "## Two"]));
	assert.deepEqual(
		headings.map((h) => [h.level, h.text, h.line]),
		[
			[1, "One", 1],
			[3, "Three", 3],
			[2, "Two", 4],
		]
	);
});

test("a hash inside a code fence is not a heading", () => {
	const headings = collectHeadings(
		docOf(["# Real", "```bash", "# not a heading", "```", "## Also real"])
	);
	assert.deepEqual(headings.map((h) => h.text), ["Real", "Also real"]);
});

test("tilde fences count too, and a mismatched one does not close", () => {
	const headings = collectHeadings(docOf(["~~~", "# inside", "```", "# still inside", "~~~", "# out"]));
	assert.deepEqual(headings.map((h) => h.text), ["out"]);
});

test("closing hashes and trailing space are trimmed off", () => {
	assert.deepEqual(collectHeadings(docOf(["## Title ##  "])).map((h) => h.text), ["Title"]);
});

test("a hash with no text is not a heading", () => {
	assert.deepEqual(collectHeadings(docOf(["#", "#hashtag", "####### seven"])), []);
});

test("the line the list lands on is skipped", () => {
	// Otherwise re-running the command over an existing list, or inserting
	// under a heading being typed, lists the line doing the inserting.
	assert.deepEqual(collectHeadings(docOf(["# One", "# Two"]), 2).map((h) => h.text), ["One"]);
});

// ── anchors ────────────────────────────────────────────────────────────────

test("characters a link cannot carry are dropped from the anchor", () => {
	assert.equal(headingAnchor("A [bracket] and #hash"), "A bracket and hash");
	assert.equal(headingAnchor("Pipe | caret ^"), "Pipe caret");
	assert.equal(headingAnchor("  spaced   out  "), "spaced out");
});

test("a heading made only of unusable characters is left out", () => {
	assert.equal(tocOf(["# ###", "# Real"]), "- [[#Real|Real]]");
});

// ── nesting ────────────────────────────────────────────────────────────────

test("the list nests by heading level", () => {
	assert.equal(
		tocOf(["# One", "## Two", "### Three", "## Another two"]),
		[
			"- [[#One|One]]",
			"\t- [[#Two|Two]]",
			"\t\t- [[#Three|Three]]",
			"\t- [[#Another two|Another two]]",
		].join("\n")
	);
});

test("a note whose top level is H2 still starts flush left", () => {
	assert.equal(
		tocOf(["## Alpha", "### Bravo"]),
		["- [[#Alpha|Alpha]]", "\t- [[#Bravo|Bravo]]"].join("\n")
	);
});

test("a skipped heading level indents one step, not two", () => {
	// H1 then H3 with no H2 is a gap in the note, not a gap the reader should
	// see as two levels of indent in the list.
	assert.equal(
		tocOf(["# One", "### Three"]),
		["- [[#One|One]]", "\t- [[#Three|Three]]"].join("\n")
	);
});

test("a note with no headings produces nothing at all", () => {
	assert.equal(tocOf(["just text", "- a bullet"]), "");
});

test("the indent string is configurable", () => {
	assert.equal(
		tableOfContents(collectHeadings(docOf(["# One", "## Two"])), { indent: "    " }),
		["- [[#One|One]]", "    - [[#Two|Two]]"].join("\n")
	);
});

// ── the title line ─────────────────────────────────────────────────────────

test("the title goes on the first line, above the links", () => {
	assert.equal(
		titledTocOf(["# One", "## Two"]),
		["**Table of contents**", "- [[#One|One]]", "\t- [[#Two|Two]]"].join("\n")
	);
});

test("the title is bold text, not a heading", () => {
	// A `## Table of contents` would list itself the next time the command
	// runs, and would show up in the outline pane as a section that is not one.
	const first = titledTocOf(["# One"]).split("\n")[0];
	assert.equal(first.startsWith("#"), false);
	assert.equal(collectHeadings(docOf([first])).length, 0);
});

test("no headings means no title either", () => {
	assert.equal(titledTocOf(["just text"]), "", "a title over an empty list is worse than nothing");
});

// ── staying inside a callout ───────────────────────────────────────────────

test("the callout prefix is read off the line", () => {
	assert.equal(quotePrefix("> [!info] Notes"), "> ");
	assert.equal(quotePrefix("> "), "> ");
	assert.equal(quotePrefix(">> nested"), ">> ");
	assert.equal(quotePrefix("  > indented quote"), "  > ");
	assert.equal(quotePrefix("plain text"), "");
});

test("every line of the list carries the callout prefix", () => {
	// Without this the first row stays inside the callout and the rest fall out
	// the bottom as loose text.
	const body = titledTocOf(["# One", "## Two"]);
	assert.equal(
		prefixLines(body, "> "),
		[
			"> **Table of contents**",
			"> - [[#One|One]]",
			"> \t- [[#Two|Two]]",
		].join("\n")
	);
});

test("the first line is left bare when the caret is already past the marker", () => {
	const body = titledTocOf(["# One"]);
	assert.equal(
		prefixLines(body, "> ", true),
		["**Table of contents**", "> - [[#One|One]]"].join("\n")
	);
});

test("no prefix leaves the list untouched", () => {
	assert.equal(prefixLines("a\nb", ""), "a\nb");
});
