import { Text } from "@codemirror/state";
import { reindentBlock } from "./dragRange";

/**
 * Works out the exact edits that move a block, as a single change set.
 *
 * Extracted from DragManager so the newline arithmetic can be tested against
 * resulting document TEXT rather than reasoned about. Off-by-one errors here
 * do not throw — they silently leave a stray blank line or glue two blocks
 * together, which is exactly the class of bug that reached the user.
 */

export interface MoveSource {
	from: number;
	to: number;
	text: string;
	indent: number;
	firstLine: number;
	lastLine: number;
}

export interface MoveChange {
	from: number;
	to?: number;
	insert?: string;
}

/**
 * Returns the changes that move `source` so it lands before `toLineNo`, at
 * `targetIndent`. Returns an empty array when the move is a no-op.
 *
 * Both edits are returned together so they apply as one transaction: one undo
 * step, and no intermediate state where the block exists twice or not at all.
 */
export function planBlockMove(
	doc: Text,
	source: MoveSource,
	toLineNo: number,
	targetIndent: number
): MoveChange[] {
	const text = reindentBlock(source.text, source.indent, targetIndent);

	// Dropping back into the block's own span changes nothing.
	//
	// The lower bound is >=, not >. Dropping exactly at the block's own first
	// line produced an insert and a delete that both started at that offset:
	// they overlap, CodeMirror rejects overlapping changes, and the string
	// simulation instead produced a document with a stray leading blank line.
	if (toLineNo >= source.firstLine && toLineNo <= source.lastLine + 1) return [];

	// The source span plus the newline that terminates it. When the block runs
	// to the end of the document there is no trailing newline to remove, so the
	// PRECEDING one is taken instead — otherwise the document keeps a blank
	// line where the block used to be.
	const atDocEnd = source.to >= doc.length;
	const cutFrom = atDocEnd ? Math.max(0, source.from - 1) : source.from;
	const cutTo = atDocEnd ? doc.length : Math.min(source.to + 1, doc.length);

	// Appending past the last line.
	if (toLineNo > doc.lines) {
		return [
			{ from: doc.length, insert: "\n" + text },
			{ from: cutFrom, to: cutTo },
		];
	}

	const toLine = doc.line(toLineNo);

	return [
		{ from: toLine.from, insert: text + "\n" },
		{ from: cutFrom, to: cutTo },
	];
}

/**
 * Applies planned changes to a plain string. Test helper only — the editor
 * applies them through CodeMirror — but it lets tests assert on the document
 * a user would actually see.
 */
export function applyChanges(docText: string, changes: MoveChange[]): string {
	// Apply from the end backwards so earlier offsets stay valid.
	const ordered = [...changes].sort((a, b) => b.from - a.from);
	let out = docText;
	for (const change of ordered) {
		const to = change.to ?? change.from;
		out = out.slice(0, change.from) + (change.insert ?? "") + out.slice(to);
	}
	return out;
}
