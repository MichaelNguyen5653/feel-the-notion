import { EditorSelection, Text } from "@codemirror/state";

/**
 * Works out what a drag from a given handle should actually pick up.
 *
 * THREE CASES, IN PRIORITY ORDER
 *
 * 1. The handle sits inside a multi-block selection -> drag ALL selected
 *    blocks. This is the case that was missing: you would select three
 *    paragraphs, grab one, and watch a single line come away while the other
 *    two stayed put. Notion moves the whole selection.
 *
 * 2. Granularity is "paragraph" -> drag the contiguous run of non-blank lines
 *    around the handle. A wrapped paragraph is one block to the reader, so
 *    dragging half of it is never what was meant.
 *
 *    The handle's own line must be non-blank for this to apply. Without that
 *    guard, grabbing a blank separator line expanded upward across it and
 *    carried off the paragraph above — the blank line is a block boundary,
 *    not a member of the block it precedes.
 *
 * 3. Granularity is "line" -> drag exactly the one line.
 *
 * Pure, so the boundary arithmetic is testable without a DOM.
 * See test/dragRange.test.mjs.
 */

export type DragGranularity = "line" | "paragraph";

export interface DragRange {
	from: number;
	to: number;
	/** Line numbers covered, inclusive. Used for the drag ghost's label. */
	firstLine: number;
	lastLine: number;
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
			if (first === last) continue; // single block — not a block selection
			if (lineNo >= first && lineNo <= last) {
				return {
					from: doc.line(first).from,
					to: doc.line(last).to,
					firstLine: first,
					lastLine: last,
				};
			}
		}
	}

	// 2. Whole paragraph: expand across adjacent non-blank lines.
	if (granularity === "paragraph" && doc.line(lineNo).text.trim() !== "") {
		let first = lineNo;
		while (first > 1 && doc.line(first - 1).text.trim() !== "") first--;
		let last = lineNo;
		while (last < doc.lines && doc.line(last + 1).text.trim() !== "") last++;
		return {
			from: doc.line(first).from,
			to: doc.line(last).to,
			firstLine: first,
			lastLine: last,
		};
	}

	// 3. Just the one line.
	const line = doc.line(lineNo);
	return { from: line.from, to: line.to, firstLine: lineNo, lastLine: lineNo };
}
