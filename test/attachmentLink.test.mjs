/**
 * Tests for how a saved attachment is written into the note.
 *
 * The requirement is a markdown link with no leading "!" unless the setting
 * asks for one — but Obsidian generates a wikilink in most vaults, so the
 * conversion has to be exact or the link silently points at nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { encodeLinkPath, linkDisplayName, toMarkdownLink } from "./.build/attachmentLink.js";

test("a wikilink becomes a markdown link", () => {
	assert.equal(
		toMarkdownLink("[[Attachments/report.pdf]]", "Attachments/report.pdf", false),
		"[report](Attachments/report.pdf)"
	);
});

test("a wikilink alias becomes the link text", () => {
	assert.equal(
		toMarkdownLink("[[Attachments/report.pdf|Q4 report]]", "Attachments/report.pdf", false),
		"[Q4 report](Attachments/report.pdf)"
	);
});

test("no leading exclamation mark by default", () => {
	// The whole point of the setting: a link, not an embed.
	assert.equal(toMarkdownLink("![[a.pdf]]", "a.pdf", false).startsWith("!"), false);
	assert.equal(toMarkdownLink("![](a.pdf)", "a.pdf", false).startsWith("!"), false);
});

test("the embed setting adds the exclamation mark back", () => {
	assert.equal(toMarkdownLink("[[a.pdf]]", "a.pdf", true), "![a](a.pdf)");
});

test("a markdown link is passed through", () => {
	assert.equal(
		toMarkdownLink("[report](Attachments/report.pdf)", "Attachments/report.pdf", false),
		"[report](Attachments/report.pdf)"
	);
});

test("an empty label is filled with the file name", () => {
	assert.equal(toMarkdownLink("[](Attachments/report.pdf)", "Attachments/report.pdf", false),
		"[report](Attachments/report.pdf)");
});

// ── encoding ───────────────────────────────────────────────────────────────

test("spaces are encoded", () => {
	assert.equal(encodeLinkPath("Attachments/my file.pdf"), "Attachments/my%20file.pdf");
});

test("parentheses are encoded", () => {
	// An unescaped ")" closes the markdown link early, leaving broken text.
	assert.equal(encodeLinkPath("a/report (final).pdf"), "a/report%20%28final%29.pdf");
});

test("slashes stay readable", () => {
	assert.equal(encodeLinkPath("a/b/c.png"), "a/b/c.png");
});

test("a wikilink with a space is encoded on conversion", () => {
	assert.equal(
		toMarkdownLink("[[Attachments/my file.pdf]]", "Attachments/my file.pdf", false),
		"[my file](Attachments/my%20file.pdf)"
	);
});

// ── display name ───────────────────────────────────────────────────────────

test("the display name drops the folder and the extension", () => {
	assert.equal(linkDisplayName("Attachments/report.pdf"), "report");
	assert.equal(linkDisplayName("report.pdf"), "report");
});

test("a dotfile keeps its name", () => {
	assert.equal(linkDisplayName(".gitignore"), ".gitignore");
});

test("a name with several dots loses only the extension", () => {
	assert.equal(linkDisplayName("notes/v1.2.final.pdf"), "v1.2.final");
});
