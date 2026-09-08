import { Text } from "@codemirror/state";
import { resolveDragRange } from "./dragRange";

/**
 * Where the "Insert a new line" row puts its line.
 *
 * WHY THIS EXISTS
 * The row is an escape hatch. A table or a code block sitting at the end of a
 * note leaves nowhere to type: there is no line under it to click into, and
 * inside a fence the slash menu is deliberately dead, because a `/` in code is
 * a path separator.
 *
 * So the line goes after the whole block, never after the current line. The
 * `+` handle sits on whichever line the pointer is over, and putting a blank
 * line after the first row of a table would cut the table in half — the exact
 * failure this row exists to avoid.
 *
 * Pure, so the boundary arithmetic is testable without a DOM.
 * See test/blankLine.test.mjs.
 */

/** A table row: a pipe is the first thing on the line. */
const TABLE_ROW = /^[ \t]*\|/;

/**
 * The line the new blank line should follow.
 *
 * Tables are walked here rather than in dragRange because nothing else in the
 * plugin treats a table as one block, and teaching the drag about them is a
 * behaviour change nobody asked for. Everything else already resolves
 * correctly through resolveDragRange: it knows fences, and it knows a list
 * item owns its children.
 */
export function blankLineAfter(doc: Text, lineNo: number): number {
	// Only a line that is itself a row walks the run. Testing the line below
	// instead would let a paragraph sitting above a table swallow it.
	if (TABLE_ROW.test(doc.line(lineNo).text)) {
		let end = lineNo;
		while (end < doc.lines && TABLE_ROW.test(doc.line(end + 1).text)) end++;
		return end;
	}

	return resolveDragRange(doc, lineNo, "paragraph").lastLine;
}
