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
		const previous = doc.line(start - 1);
		if (isBlank(previous.text)) break;

		// Stop below a structured line at the same or shallower indent. It owns
		// only what is nested under it — the mirror of findBlockEnd's rule — so
		// a plain line sitting level with it is a separate block.
		//
		// Without this the line after a closing ``` or a heading walked up INTO
		// that line, and the walk then stopped there and returned ITS range:
		// grabbing the paragraph under a heading dragged the heading instead.
		if (
			isBlockStart(previous.text) &&
			indentWidth(previous.text) >= indentWidth(doc.line(start).text)
		) {
			break;
		}
		start--;
	}
	return start;
}

/**
 * Walks down to the last line owned by the block starting at `start`.
 *
 * Always includes lines indented deeper — nested items and their own children
 * travel with the parent.
 *
 * Lines at the SAME indent are where it gets subtle, and getting it wrong was
 * a real bug. A structured block (list item, heading, quote) owns only what is
 * indented under it: a list item's continuation has to reach the content
 * column, so a line sitting back at the marker's own indent is a separate
 * block, not part of this one. Absorbing those meant dragging
 *
 *     - The shirt is white
 *     The score is now 1-1
 *     bob's furniture
 *
 * by its first line carried all three away, scattering two paragraphs the user
 * never touched.
 *
 * Plain prose is the opposite: it has no marker, so consecutive same-indent
 * lines ARE one wrapped paragraph and must stay together.
 */
function findBlockEnd(doc: Text, start: number): number {
	const startText = doc.line(start).text;
	const baseIndent = indentWidth(startText);
	// Structured blocks own only what is nested beneath them.
	const ownsOnlyDeeper = isBlockStart(startText);
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
		// Same indent: only prose absorbs it, as a wrapped continuation.
		if (!ownsOnlyDeeper && nextIndent === baseIndent && !isBlockStart(next.text)) {
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

/** A list item or task, as opposed to prose or a heading. */
export function isListItem(text: string): boolean {
	return /^[ \t]*([-*+]|\d+[.)])[ \t]/.test(text);
}

/**
 * Infers how many columns one indent level is worth in this document.
 *
 * Vaults differ — two spaces, four, or a tab — and guessing wrong makes the
 * drop indent land between levels, which is exactly what desynchronises
 * Bullet Depth Markers. The smallest indent actually in use is the safest
 * read; four is the fallback when the document has no indentation to learn
 * from.
 */
export function detectIndentUnit(doc: Text, fallback = 4): number {
	let smallest = Infinity;
	const limit = Math.min(doc.lines, 500); // enough to infer, cheap to scan

	for (let n = 1; n <= limit; n++) {
		const width = indentWidth(doc.line(n).text);
		if (width > 0 && width < smallest) smallest = width;
	}

	return smallest === Infinity ? fallback : smallest;
}

/**
 * The indent levels a block may legally be dropped at, before `dropLineNo`.
 *
 * Markdown will not let an item be more than one level deeper than the item
 * above it — nest further and the renderer silently flattens it — so the
 * deepest offer is one level past the preceding line.
 *
 * Returns a single option when there is nothing to indent under. Prose at
 * column zero offers no choice at all, which is what keeps the drag behaving
 * exactly as before in a document with no lists in it.
 */
export function allowedIndents(doc: Text, dropLineNo: number, unit: number): number[] {
	let prev: string | null = null;
	for (let n = Math.min(dropLineNo - 1, doc.lines); n >= 1; n--) {
		const text = doc.line(n).text;
		if (!isBlank(text)) {
			prev = text;
			break;
		}
	}

	if (prev === null) return [0];

	const prevIndent = indentWidth(prev);

	// Flat prose: no indented context exists, so offer no indent choice.
	if (!isListItem(prev) && prevIndent === 0) return [0];

	const deepest = prevIndent + (isListItem(prev) ? unit : 0);

	const levels: number[] = [];
	for (let i = 0; i <= deepest; i += unit) levels.push(i);
	return levels.length > 0 ? levels : [0];
}

/** Snaps a freely-chosen indent to the nearest legal one. */
export function pickIndent(allowed: number[], desired: number): number {
	return allowed.reduce(
		(best, candidate) =>
			Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best,
		allowed[0]
	);
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
