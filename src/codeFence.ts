import { Text } from "@codemirror/state";

/**
 * Whether a line sits inside a fenced code block.
 *
 * Both of the block-level behaviours have to stay out of code. Inside a fence,
 * `# ` is a comment rather than a heading and Backspace stripping it would
 * silently rewrite the code; `/` is a path separator, and popping an insert
 * menu over it interrupts ordinary typing.
 *
 * Counted from the fences above rather than read from the syntax tree, so this
 * stays pure and testable — and independent of how Obsidian happens to parse
 * the document today.
 */
export function isInsideCodeFence(doc: Text, lineNo: number): boolean {
	const FENCE = /^\s*(```|~~~)/;
	let open: string | null = null;

	// `to` is exclusive, so this reads every line ABOVE the one in question.
	for (const text of doc.iterLines(1, Math.max(1, Math.min(lineNo, doc.lines + 1)))) {
		const match = FENCE.exec(text);
		if (match) {
			// A fence closes only with the same character it opened with, so a
			// ``` block containing ~~~ stays one block.
			if (open === null) open = match[1];
			else if (match[1] === open) open = null;
		}
	}

	return open !== null;
}
