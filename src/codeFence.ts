import { Text } from "@codemirror/state";

/**
 * Finding fenced code blocks.
 *
 * Two things need this. Block-level editing has to stay OUT of code — inside a
 * fence `#` is a comment and `/` is a path separator, so neither Backspace nor
 * the slash menu should act there. And Cmd+A has to treat a fence as one thing,
 * because the markdown-shaped logic it normally uses reads the code's own text
 * as markdown: a `#` comment looks like a heading, a `-` looks like a bullet,
 * and the selection lands wherever the code happens to resemble a marker.
 *
 * Counted from the fences themselves rather than read from the syntax tree, so
 * this stays pure and testable, and independent of how Obsidian happens to
 * parse a document today.
 *
 * See test/codeFence.test.mjs.
 */

const FENCE = /^\s*(```|~~~)/;

export interface CodeFence {
	/** 1-based line of the opening fence. */
	openLine: number;
	/** 1-based line of the closing fence, or null when the fence is unclosed. */
	closeLine: number | null;
}

/**
 * The fenced block containing `lineNo`, or null when it is not in one.
 *
 * Both fence lines count as part of the block, so Cmd+A on the ``` itself
 * selects the code rather than the one line the caret happens to sit on.
 */
export function findCodeFence(doc: Text, lineNo: number): CodeFence | null {
	let openChar: string | null = null;
	let openLine = 0;
	let n = 0;

	for (const text of doc.iterLines()) {
		n++;
		const match = FENCE.exec(text);

		if (n <= lineNo) {
			if (match) {
				if (openChar === null) {
					openChar = match[1];
					openLine = n;
				} else if (match[1] === openChar) {
					// A fence closes only with the character it opened with, so
					// a ``` block containing ~~~ stays one block.
					if (n === lineNo) return { openLine, closeLine: n };
					openChar = null;
					openLine = 0;
				}
			}
			if (n === lineNo && openChar === null) return null;
			continue;
		}

		// Past the line in question and inside a fence: find where it closes.
		if (match && match[1] === openChar) return { openLine, closeLine: n };
	}

	return openChar === null ? null : { openLine, closeLine: null };
}

/**
 * Whether a line sits inside a fenced block, the opening fence excluded.
 *
 * The opening fence is still ordinary markdown as far as editing goes — it is
 * the line you type to start a code block — so Backspace and the slash menu
 * stay live on it.
 */
export function isInsideCodeFence(doc: Text, lineNo: number): boolean {
	const fence = findCodeFence(doc, lineNo);
	return fence !== null && lineNo > fence.openLine;
}

/**
 * All line numbers inside a fenced block, for the whole document, in one pass.
 *
 * findCodeFence rescans from line 1 every time it is called, which is fine for
 * the odd lookup triggered by a keypress but not for a check run per visible
 * line on every keystroke and selection change — that pattern would make the
 * caller O(lines × docLines). Compute the set once per pass instead and query
 * it with plain has() calls.
 *
 * Same convention as isInsideCodeFence: the opening fence line is not "inside",
 * every line after it up to and including the closer is.
 */
export function findFencedLines(doc: Text): Set<number> {
	const fenced = new Set<number>();
	let openChar: string | null = null;
	let n = 0;

	for (const text of doc.iterLines()) {
		n++;
		const match = FENCE.exec(text);

		if (openChar !== null) {
			fenced.add(n);
			if (match && match[1] === openChar) {
				// A fence closes only with the character it opened with, so a ```
				// block containing ~~~ stays one block. See findCodeFence above.
				openChar = null;
			}
			continue;
		}

		if (match) openChar = match[1];
	}

	return fenced;
}

/**
 * The code between the fences, as document offsets.
 *
 * Excludes the fence lines: this is what you would want on the clipboard.
 * Returns null for an empty block, where there is nothing to select — the
 * caller escalates rather than selecting a zero-width range and leaving Cmd+A
 * stuck on it.
 */
export function codeFenceContent(doc: Text, lineNo: number): { from: number; to: number } | null {
	const fence = findCodeFence(doc, lineNo);
	if (!fence) return null;

	const first = fence.openLine + 1;
	const last = fence.closeLine === null ? doc.lines : fence.closeLine - 1;
	if (last < first) return null;

	return { from: doc.line(first).from, to: doc.line(last).to };
}
