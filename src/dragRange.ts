import { EditorSelection, Text } from "@codemirror/state";

/**
 * Works out what a drag should actually pick up, and at what indent it should
 * land.
 *
 * THE MENTAL MODEL
 * A "block" is what the reader sees as one thing. That is rarely one line:
 * a wrapped paragraph is several, and a list item owns everything nested
 * beneath it. Grabbing any line of a block must take the whole block, and a
 * parent must bring its children.
 *
 * PRIORITY ORDER
 * 1. A multi-block selection containing the handle -> drag the whole
 *    selection, minus any blank lines at its edges.
 * 2. Granularity "paragraph" -> the block containing the handle, plus every
 *    line nested under it.
 * 3. Granularity "line" -> exactly one line.
 *
 * Pure, so all the boundary arithmetic is testable without a DOM.
 * See test/dragRange.test.mjs.
 */

export type DragGranularity = "line" | "paragraph";

export interface DragRange {
	from: number;
	to: number;
	firstLine: number;
	lastLine: number;
	/** Indent width of the block's first line, for re-indenting on drop. */
	indent: number;
}

/** A tab counts as 4 columns, matching Obsidian's default list indent. */
const TAB_WIDTH = 4;

export function indentWidth(text: string): number {
	let width = 0;
	for (const ch of text) {
		if (ch === " ") width += 1;
		else if (ch === "\t") width += TAB_WIDTH;
		else break;
	}
	return width;
}

/** The leading whitespace itself, preserved verbatim. */
export function indentString(text: string): string {
	return /^[ \t]*/.exec(text)?.[0] ?? "";
}

export function isBlank(text: string): boolean {
	return text.trim() === "";
}

/**
 * True when a line opens a new block rather than continuing the previous one:
 * list items, headings, blockquotes, and fences.
 *
 * This is what stops a walk upward from a list item swallowing its siblings —
 * an item is its own block start, so the walk stops immediately.
 */
export function isBlockStart(text: string): boolean {
	return (
		/^[ \t]*([-*+]|\d+[.)])[ \t]/.test(text) || // list item or task
		/^[ \t]*#{1,6}[ \t]/.test(text) || // heading
		/^[ \t]*>/.test(text) || // blockquote
		/^[ \t]*(```|~~~|\$\$)/.test(text) // fence
	);
}

/**
 * Walks up to the first line of the block containing `lineNo`.
 *
 * Stops at a block start, because that line owns itself. A plain wrapped
 * paragraph has no block starts, so the walk runs to the blank line above it,
 * which is what makes grabbing any line of a paragraph take all of it.
 */
function findBlockStart(doc: Text, lineNo: number): number {
	let start = lineNo;
	while (start > 1) {
		if (isBlockStart(doc.line(start).text)) break;
		if (isBlank(doc.line(start - 1).text)) break;
		start--;
	}
	return start;
}

/**
 * Walks down to the last line owned by the block starting at `start`.
 *
 * Includes anything indented deeper — nested list items and their own
 * children — and any non-block-start line at the same indent, which is how a
 * wrapped paragraph stays whole.
 */
function findBlockEnd(doc: Text, start: number): number {
	const baseIndent = indentWidth(doc.line(start).text);
	let end = start;

	while (end < doc.lines) {
		const next = doc.line(end + 1);
		if (isBlank(next.text)) break;

		const nextIndent = indentWidth(next.text);
		// Deeper: a child of this block, so it travels with the parent.
		if (nextIndent > baseIndent) {
			end++;
			continue;
		}
		// Same indent and not opening a new block: a wrapped continuation.
		if (nextIndent === baseIndent && !isBlockStart(next.text)) {
			end++;
			continue;
		}
		break;
	}

	return end;
}

/** Drops blank lines from both ends of a line span. */
function trimBlankEdges(doc: Text, first: number, last: number): [number, number] {
	while (first < last && isBlank(doc.line(first).text)) first++;
	while (last > first && isBlank(doc.line(last).text)) last--;
	return [first, last];
}

function toRange(doc: Text, first: number, last: number): DragRange {
	return {
		from: doc.line(first).from,
		to: doc.line(last).to,
		firstLine: first,
		lastLine: last,
		indent: indentWidth(doc.line(first).text),
	};
}

export function resolveDragRange(
	doc: Text,
	lineNo: number,
	granularity: DragGranularity,
	selection?: EditorSelection
): DragRange {
	// 1. Multi-block selection containing the handle wins over everything.
	if (selection) {
		for (const range of selection.ranges) {
			if (range.empty) continue;
			const first = doc.lineAt(range.from).number;
			const last = doc.lineAt(range.to).number;
			if (first === last) continue; // within one block — not a block selection
			if (lineNo >= first && lineNo <= last) {
				// Blank lines at the edges are selection slop, not content the
				// user meant to move.
				const [f, l] = trimBlankEdges(doc, first, last);
				return toRange(doc, f, l);
			}
		}
	}

	// 2. Whole block, including everything nested under it.
	//    A blank line is a boundary, not a block, so it only ever moves alone.
	if (granularity === "paragraph" && !isBlank(doc.line(lineNo).text)) {
		const start = findBlockStart(doc, lineNo);
		const end = findBlockEnd(doc, start);
		return toRange(doc, start, end);
	}

	// 3. Just the one line.
	return toRange(doc, lineNo, lineNo);
}

/**
 * Re-indents a block so it adopts a new depth, keeping its internal shape.
 *
 * Dropping a block beside an indented one used to insert it at its original
 * depth, which broke the nesting and desynchronised the bullet characters that
 * Bullet Depth Markers keeps tied to depth. Shifting every line by the same
 * delta moves the block without flattening its own children.
 *
 * Lines are never pushed past column zero, and blank lines stay blank rather
 * than collecting trailing whitespace.
 */
export function reindentBlock(text: string, fromIndent: number, toIndent: number): string {
	const delta = toIndent - fromIndent;
	if (delta === 0) return text;

	return text
		.split("\n")
		.map((line) => {
			if (isBlank(line)) return "";
			const current = indentWidth(line);
			const body = line.slice(indentString(line).length);
			return " ".repeat(Math.max(0, current + delta)) + body;
		})
		.join("\n");
}
