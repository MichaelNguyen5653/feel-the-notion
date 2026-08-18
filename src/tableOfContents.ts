import { Text } from "@codemirror/state";

/**
 * Builds a table of contents from the headings in a note.
 *
 * A snapshot, not a live view: it writes plain markdown that keeps working if
 * the plugin is removed, and it does not rewrite itself when headings change.
 * Re-running the command over the old list is the way to refresh it.
 *
 * Pure, so the fence handling, the nesting and the character escaping are all
 * testable without an editor. See test/tableOfContents.test.mjs.
 */

export interface Heading {
	level: number;
	text: string;
	line: number;
}

/** ATX heading: up to three leading spaces, then 1-6 hashes and a space. */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Every heading in the document, in order.
 *
 * `skipLine` is the line the table of contents is about to land on. Without it
 * a table of contents inserted under a heading could list the `/query` line
 * itself once it became a heading, and re-running the command over an existing
 * list would list its own placeholder.
 *
 * Fenced code is skipped: `# comment` inside a shell block is a comment, not a
 * heading, and a table of contents that links to it links to nothing.
 */
export function collectHeadings(doc: Text, skipLine = 0): Heading[] {
	const headings: Heading[] = [];
	let openFence: string | null = null;
	let n = 0;

	for (const text of doc.iterLines()) {
		n++;

		const fence = FENCE.exec(text);
		if (fence) {
			if (openFence === null) openFence = fence[1];
			else if (fence[1] === openFence) openFence = null;
			continue;
		}
		if (openFence !== null) continue;
		if (n === skipLine) continue;

		const match = HEADING.exec(text);
		if (!match) continue;
		const label = match[2].trim();
		if (label.length === 0) continue;

		headings.push({ level: match[1].length, text: label, line: n });
	}

	return headings;
}

/**
 * The heading text as a link target Obsidian can resolve.
 *
 * `#`, `|`, `[`, `]` and `^` all mean something inside a link, so a heading
 * containing them cannot be linked to verbatim — Obsidian drops them from the
 * anchor and so does this.
 */
export function headingAnchor(text: string): string {
	return text
		.replace(/[[\]#|^]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * A nested bullet list of links, one per heading.
 *
 * Nesting is relative to the shallowest heading present, so a note whose top
 * level is H2 does not start the list one level indented. Levels are collapsed
 * rather than preserved: H1 followed by H3 with no H2 between them indents by
 * one step, not two, because the skipped level is a gap in the note's headings
 * and not a gap the reader should see in the list.
 *
 * Returns "" when there is nothing to list, which is the caller's cue to say
 * so rather than insert an empty bullet — including when a title was asked
 * for, because a title over an empty list is worse than nothing.
 */
export interface TocOptions {
	/** One level of nesting. A tab, unless the caller knows better. */
	indent?: string;
	/** Line written above the list. Omitted when empty. */
	title?: string;
}

export function tableOfContents(headings: Heading[], options: TocOptions = {}): string {
	const indent = options.indent ?? "\t";
	const linkable = headings
		.map((heading) => ({ level: heading.level, anchor: headingAnchor(heading.text) }))
		.filter((heading) => heading.anchor.length > 0);

	if (linkable.length === 0) return "";

	// Depth is counted over the levels actually used, so the list never indents
	// past the number of distinct heading levels in the note.
	const levels = [...new Set(linkable.map((heading) => heading.level))].sort((a, b) => a - b);
	const depthOf = new Map(levels.map((level, index) => [level, index]));

	const rows = linkable.map((heading) => {
		const depth = depthOf.get(heading.level) ?? 0;
		// Aliased on purpose: `[[#Heading]]` renders with the hash still in it,
		// which reads as markup rather than as a contents entry.
		return `${indent.repeat(depth)}- [[#${heading.anchor}|${heading.anchor}]]`;
	});

	// Bold rather than a heading. A `## Table of contents` would list itself the
	// next time the command runs, and would show up in the outline pane as a
	// section the note does not actually have.
	const title = options.title?.trim();
	return title ? [`**${title}**`, ...rows].join("\n") : rows.join("\n");
}

/**
 * The blockquote or callout prefix a line carries, e.g. `"> "` or `">> "`.
 *
 * A multi-line insert into a callout has to repeat this on every line. Without
 * it the first row stays inside the callout and every row after it falls out
 * the bottom as plain text, which is what a table of contents inserted into an
 * `> [!info]` block used to do.
 */
export function quotePrefix(lineText: string): string {
	return /^[ \t]*(?:>[ \t]?)+/.exec(lineText)?.[0] ?? "";
}

/** Repeats `prefix` on each line, optionally leaving the first one alone. */
export function prefixLines(text: string, prefix: string, skipFirst = false): string {
	if (prefix.length === 0) return text;
	return text
		.split("\n")
		.map((line, index) => (skipFirst && index === 0 ? line : prefix + line))
		.join("\n");
}
