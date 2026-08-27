import { Text } from "@codemirror/state";
import { findBlockEnd, findBlockStart, isBlank } from "./dragRange";

/**
 * What a block fold would hide.
 *
 * THE RULE
 * A fold only exists where there is something to hide. A single-line
 * paragraph with nothing under it returns null, and the handle uses that to
 * decide whether to draw a chevron at all — a button that visibly does
 * nothing is worse than no button.
 *
 * TWO SHAPES OF FOLDABLE THING
 * A heading owns everything down to the next heading of the same or shallower
 * level, which is how an outline reads. Everything else owns exactly what is
 * indented under it, which is the same block model the drag already uses, via
 * the same two walks.
 *
 * Pure. See test/foldRange.test.mjs.
 */

export interface FoldRange {
	/** The line that stays visible, carrying the ellipsis. */
	headLine: number;
	/** Last line hidden by the fold. */
	lastLine: number;
}

/** Heading level, or 0 when the line is not an ATX heading. */
export function headingLevel(text: string): number {
	const match = /^[ \t]*(#{1,6})[ \t]/.exec(text);
	return match ? match[1].length : 0;
}

/**
 * The range a fold at `lineNo` would hide, or null when there is nothing.
 *
 * A line folds what it owns, never what owns it. The walk is the one the
 * drag already uses, so a leaf list item folds nothing and a parent folds
 * its children. Folding a parent from its child's line would hide the very
 * line the pointer is on.
 */
export function foldableRange(doc: Text, lineNo: number): FoldRange | null {
	if (lineNo < 1 || lineNo > doc.lines) return null;

	const line = doc.line(lineNo);
	if (isBlank(line.text)) return null;

	const level = headingLevel(line.text);
	if (level > 0) return headingSection(doc, lineNo, level);

	const start = findBlockStart(doc, lineNo);
	const end = findBlockEnd(doc, start);
	return end > start ? { headLine: start, lastLine: end } : null;
}

/** Everything under a heading, down to the next one at the same depth or shallower. */
function headingSection(doc: Text, lineNo: number, level: number): FoldRange | null {
	let last = lineNo;

	for (let n = lineNo + 1; n <= doc.lines; n++) {
		const next = headingLevel(doc.line(n).text);
		// A deeper heading is part of this section. An equal or shallower one
		// starts the next.
		if (next > 0 && next <= level) break;
		last = n;
	}

	// Trailing blanks are the gap before the next heading, not this section's
	// content. Hiding them would leave the ellipsis stranded on an empty line.
	while (last > lineNo && isBlank(doc.line(last).text)) last--;

	return last > lineNo ? { headLine: lineNo, lastLine: last } : null;
}
