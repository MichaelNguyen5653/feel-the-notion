import { EditorSelection, Text } from "@codemirror/state";

/**
 * Works out what a drag should actually pick up, and at what indent it should
 * land.
 *
 * THE MENTAL MODEL
 * A "block" is what the reader sees as one thing: one document line, plus
 * everything indented beneath it. Soft wrapping does not split a line, so a
 * paragraph that runs over three rows is still one block; two lines sitting at
 * the same indent are two blocks even with no blank line between them, which
 * is exactly how Obsidian renders them. A parent brings its children.
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
 * Only a line indented DEEPER than the one above it is a continuation of it.
 * Everything else starts its own block.
 *
 * This used to walk up through every consecutive non-blank line, on the theory
 * that a wrapped paragraph is one block. That theory was wrong: soft wrapping
 * does not create document lines, so a "wrapped paragraph" is a single line
 * already. What the walk actually collected was separate lines the reader sees
 * as separate blocks — and dragging any one of them moved the whole run and
 * re-indented all of it, which is the bug this rule exists to fix.
 */
export function findBlockStart(doc: Text, lineNo: number): number {
	let start = lineNo;
	while (start > 1) {
		const current = doc.line(start);
		// A marker line owns itself. A list item, heading, quote or fence is
		// never a continuation of whatever sits above it.
		if (isBlockStart(current.text)) break;

		const previous = doc.line(start - 1);
		if (isBlank(previous.text)) break;

		// Same indent or shallower: a block of its own, not a continuation.
		if (indentWidth(current.text) <= indentWidth(previous.text)) break;

		start--;
	}
	return start;
}

/**
 * Walks down to the last line owned by the block starting at `start`.
 *
 * A block owns exactly what is indented under it: nested items, their own
 * children, and continuation lines. Anything back at the block's own indent is
 * the next block, whether or not it carries a marker.
 *
 * Absorbing same-indent lines was the other half of the bug above. Dragging
 *
 *     The shirt is white
 *     The score is now 1-1
 *     bob's furniture
 *
 * by its first line carried all three away, scattering two blocks the user
 * never touched.
 */
export function findBlockEnd(doc: Text, start: number): number {
	const baseIndent = indentWidth(doc.line(start).text);
	let end = start;

	while (end < doc.lines) {
		const next = doc.line(end + 1);
		if (isBlank(next.text)) break;
		if (indentWidth(next.text) <= baseIndent) break;
		end++;
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

/** Characters of block text the drag ghost shows before truncating. */
const GHOST_TEXT_LIMIT = 50;

/**
 * How many blocks a line span contains.
 *
 * Not a line count: a block owns everything nested under it, so a list item
 * with two children is one block across three lines. Blank lines are
 * boundaries and are not counted.
 */
export function countBlocks(doc: Text, firstLine: number, lastLine: number): number {
	let count = 0;
	let n = firstLine;

	while (n <= lastLine) {
		if (isBlank(doc.line(n).text)) {
			n++;
			continue;
		}
		const end = findBlockEnd(doc, findBlockStart(doc, n));
		count++;
		// max() guards against a walk that returns a line before the cursor,
		// which would otherwise spin here forever.
		n = Math.max(end, n) + 1;
	}

	return count;
}

/**
 * What the drag ghost says.
 *
 * A multi-block drag used to show the first 50 characters of the blocks
 * concatenated, which reads as run-together garbage and tells the user
 * nothing about what they picked up. Above one block the count is the only
 * useful thing to say.
 *
 * `blocksLabel` is passed in rather than looked up so this module stays free
 * of the locale helper, which reads window.localStorage and does not exist
 * under the test harness.
 */
export function describeDragGhost(text: string, blockCount: number, blocksLabel: string): string {
	if (blockCount > 1) return blocksLabel.replace("{n}", String(blockCount));

	const flat = text.trim();
	return flat.length > GHOST_TEXT_LIMIT ? `${flat.slice(0, GHOST_TEXT_LIMIT)}...` : flat;
}
