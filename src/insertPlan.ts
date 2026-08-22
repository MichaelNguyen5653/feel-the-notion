/**
 * Works out the changes and the resulting caret position for one insert.
 *
 * Extracted from insertBlock when the slash menu arrived. The slash menu has to
 * delete the `/query` the user typed in the SAME transaction as the insert —
 * two dispatches would cost two undo presses and briefly show the query text
 * next to its own result. Deleting text that sits before the insertion point
 * shifts every offset after it, and that arithmetic is exactly the kind that
 * fails silently by one character.
 */

export interface InsertChange {
	from: number;
	to?: number;
	insert?: string;
}

export interface InsertPlanInput {
	lineFrom: number;
	lineTo: number;
	lineText: string;
	insertText: string;
	/** Caret offset inside insertText. Defaults to its end. */
	cursorOffset?: number;
	/** Block inserts open a new line when the current one has content. */
	asBlock: boolean;
	/** Text to delete first — the trigger and query that opened the menu. */
	remove?: { from: number; to: number };
	/** Fixed insertion point, overriding the end of the line. */
	at?: number;
	/** Changes elsewhere in the document, carried in the same transaction. */
	extra?: InsertChange[];
	/** Markdown ignores a table that is not separated from the text above it. */
	needsBlankLine?: boolean;
	/** Whether the line above the current one has content. Read only when needsBlankLine. */
	previousLineHasContent?: boolean;
}

export interface InsertPlan {
	changes: InsertChange[];
	anchor: number;
}

export function planInsert(input: InsertPlanInput): InsertPlan {
	const { lineFrom, lineTo, lineText, insertText, remove, extra = [], needsBlankLine, previousLineHasContent } = input;
	const cursorOffset = input.cursorOffset ?? insertText.length;

	// Inline inserts land where the trigger was, not at the end of the line.
	//
	// End of line was fine while the menu only opened on an empty block: the
	// trigger was the whole line. Once it can open mid-line, "note /today more"
	// put the date after "more" instead of where the caret sat. Block inserts
	// still go to the end, because a heading spliced into the middle of a
	// sentence would cut the sentence in half.
	const defaultAt = remove && !input.asBlock ? remove.from : lineTo;

	// An insertion point inside the removed span is pushed to just after it.
	// Left alone, a change that inserts at the same offset a deletion starts
	// from is an overlap, and CodeMirror rejects overlapping changes outright.
	let at = input.at ?? defaultAt;
	if (remove && at >= remove.from && at < remove.to) at = remove.to;

	// Whether a new line is needed is judged AFTER the removal: a line holding
	// nothing but `/head` is empty once the query goes, so the heading belongs
	// on that line rather than on a new one below it.
	const remaining = remove
		? lineText.slice(0, remove.from - lineFrom) + lineText.slice(remove.to - lineFrom)
		: lineText;
	const needsNewLine = input.asBlock && remaining.trim().length > 0;

	// A table dropped straight onto the line under a paragraph, or onto an
	// empty line with no blank line above it, renders as plain text — GFM
	// tables require a blank line separating them from preceding content.
	// needsNewLine alone isn't enough: it only opens a line for a block sitting
	// on top of existing text, not the second newline a table also needs, nor
	// the case where the current line is already empty but the one above it
	// is not.
	let prefix = "";
	if (needsNewLine) {
		prefix = needsBlankLine ? "\n\n" : "\n";
	} else if (needsBlankLine && previousLineHasContent) {
		prefix = "\n";
	}

	const changes: InsertChange[] = [];
	if (remove && remove.to > remove.from) changes.push({ from: remove.from, to: remove.to });
	changes.push({ from: at, insert: prefix + insertText });
	changes.push(...extra);

	const removedBefore = remove && remove.to <= at ? remove.to - remove.from : 0;
	const anchor = at - removedBefore + prefix.length + cursorOffset;

	return { changes, anchor };
}
