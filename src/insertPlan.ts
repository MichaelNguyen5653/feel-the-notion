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
}

export interface InsertPlan {
	changes: InsertChange[];
	anchor: number;
}

export function planInsert(input: InsertPlanInput): InsertPlan {
	const { lineFrom, lineTo, lineText, insertText, remove, extra = [] } = input;
	const cursorOffset = input.cursorOffset ?? insertText.length;

	// An insertion point inside the removed span is pushed to just after it.
	// Left alone, a change that inserts at the same offset a deletion starts
	// from is an overlap, and CodeMirror rejects overlapping changes outright.
	let at = input.at ?? lineTo;
	if (remove && at >= remove.from && at < remove.to) at = remove.to;

	// Whether a new line is needed is judged AFTER the removal: a line holding
	// nothing but `/head` is empty once the query goes, so the heading belongs
	// on that line rather than on a new one below it.
	const remaining = remove
		? lineText.slice(0, remove.from - lineFrom) + lineText.slice(remove.to - lineFrom)
		: lineText;
	const needsNewLine = input.asBlock && remaining.trim().length > 0;

	const changes: InsertChange[] = [];
	if (remove && remove.to > remove.from) changes.push({ from: remove.from, to: remove.to });
	changes.push({ from: at, insert: (needsNewLine ? "\n" : "") + insertText });
	changes.push(...extra);

	const removedBefore = remove && remove.to <= at ? remove.to - remove.from : 0;
	const anchor = at - removedBefore + (needsNewLine ? 1 : 0) + cursorOffset;

	return { changes, anchor };
}
