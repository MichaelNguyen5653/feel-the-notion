import { SelectionRange, Text } from "@codemirror/state";
import { indentString, isBlank, resolveDragRange } from "./dragRange";
import { isInsideCodeFence } from "./codeFence";

/**
 * The two key behaviours that make editing feel block-shaped rather than
 * text-shaped: Cmd+A escalating outward, and Backspace at a block's start
 * peeling the block apart instead of eating a newline.
 *
 * Pure, so the boundary arithmetic is testable without a DOM.
 * See test/blockCommands.test.mjs.
 */

export interface EditPlan {
	changes: { from: number; to?: number; insert?: string }[];
	/** Where the caret lands once the changes apply. */
	anchor: number;
}

export interface SelectPlan {
	from: number;
	to: number;
}

/**
 * The prefix that makes a line a heading, list item, task, or quote.
 *
 * The task pattern comes before the bullet pattern deliberately: `- [ ] x`
 * matches both, and stripping only the `- ` would leave a stray `[ ]` behind.
 */
const MARKER = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)/;

export function blockMarker(textAfterIndent: string): string {
	return MARKER.exec(textAfterIndent)?.[1] ?? "";
}

/**
 * What Cmd+A should select next.
 *
 * Notion escalates: the block, then the whole page. Obsidian jumps straight to
 * the page, which means there is no keyboard way to grab the block you are
 * standing in. Returns null when the document is already fully selected, so
 * the default command still runs and nothing is swallowed.
 */
export function planSelectAll(doc: Text, range: SelectionRange): SelectPlan | null {
	const whole = { from: 0, to: doc.length };
	if (range.from === 0 && range.to === doc.length) return null;

	const block = resolveDragRange(doc, doc.lineAt(range.head).number, "paragraph");

	// An empty block has nothing to select, so escalate immediately rather than
	// selecting a zero-width range and leaving Cmd+A stuck on it forever.
	if (block.to <= block.from) return whole;

	const insideBlock = range.from >= block.from && range.to <= block.to;
	const isWholeBlock = range.from === block.from && range.to === block.to;
	if (insideBlock && !isWholeBlock) return { from: block.from, to: block.to };

	return whole;
}

/**
 * What Backspace should do at the start of a block.
 *
 * Three cases, in the order Notion applies them:
 *   1. indented  -> step out one level
 *   2. marked    -> drop the marker, leaving the text as a plain paragraph
 *   3. plain     -> merge into the previous block
 *
 * Returns null wherever the editor's own Backspace is already right, which is
 * most of the time — mid-line, and joining two adjacent lines.
 */
export function planBackspace(doc: Text, pos: number, unit: number): EditPlan | null {
	const line = doc.lineAt(pos);
	const indent = indentString(line.text);
	const indentEnd = line.from + indent.length;
	const marker = blockMarker(line.text.slice(indent.length));
	const contentStart = indentEnd + marker.length;

	// Past the block's first character: ordinary text deletion.
	if (pos > contentStart) return null;

	// Inside a fence none of this applies: the "markers" are code.
	if (isInsideCodeFence(doc, line.number)) return null;

	// 1. Indented. Outdent before touching the marker, so a nested item walks
	//    back to the margin one level at a time instead of losing its bullet.
	//    This deliberately covers the caret sitting after the marker too: at
	//    the start of a nested item's text, Backspace means "one level out",
	//    and only an item already at the margin gives up its bullet.
	if (indent.length > 0) {
		const trailingSpaces = indent.length - indent.replace(/ +$/, "").length;
		const removed = indent.endsWith("\t") ? 1 : Math.min(unit, trailingSpaces);
		if (removed <= 0) return null;
		return {
			changes: [{ from: indentEnd - removed, to: indentEnd }],
			anchor: Math.max(line.from, pos - removed),
		};
	}

	// 2. Marked and at the margin. Drop the marker.
	if (marker.length > 0) {
		return { changes: [{ from: line.from, to: contentStart }], anchor: line.from };
	}

	if (pos !== line.from) return null;
	if (line.number === 1) return null;

	// 3. Merge into the previous block.
	//
	// Adjacent lines are left to the editor: deleting the one newline between
	// them is already a merge. The case worth intercepting is a blank separator,
	// where deleting one newline turns two paragraphs into one paragraph with a
	// soft break — visibly a merge in the file, but not in the rendered page.
	// Removing every newline back to the previous block's last character makes
	// the two blocks genuinely one, which is what the keystroke looked like.
	let prev = line.number - 1;
	while (prev >= 1 && isBlank(doc.line(prev).text)) prev--;
	if (prev < 1) return null;
	if (prev === line.number - 1) return null;

	const target = doc.line(prev).to;
	return { changes: [{ from: target, to: line.from }], anchor: target };
}
