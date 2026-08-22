/**
 * Finds the markdown syntax markers on a line — the `**`, `_`, `==`, backticks
 * and leading `#`s that Obsidian reveals when the caret enters a line.
 *
 * Kept as a pure string -> ranges function with no CodeMirror imports, so the
 * tricky part (which characters count as a marker) is testable without a DOM.
 * See test/markerRanges.test.mjs.
 *
 * WHY THIS EXISTS
 * Live Preview removes markers from inactive lines and re-inserts them on the
 * active one. Re-inserting costs layout width, so every character after the
 * marker jumps sideways as the caret arrives. Notion never does this because it
 * has no syntax to reveal.
 *
 * Hiding markers on the active line too makes both states zero-width, so there
 * is nothing left to reflow.
 */

export interface MarkerRange {
	/** Absolute document position of the first marker character. */
	from: number;
	/** Absolute document position just past the last marker character. */
	to: number;
}

/**
 * Paired inline delimiters, longest first so `**` wins over `*` and `~~` over
 * `~`. Order matters: the scanner takes the first match at a position.
 */
const PAIRED = ["***", "___", "**", "__", "==", "~~", "*", "_"];

/** ``` fences, $$ math, and anything inside them, are left alone entirely. */
const FENCE = /^\s*(```|~~~|\$\$)/;

/**
 * Returns the marker ranges on `lineText`, as absolute positions offset by
 * `lineFrom`. Ranges are sorted and never overlap.
 *
 * Only markers with a matching closing delimiter are returned — a lone `*`
 * mid-sentence is literal text, and hiding it would delete a visible character
 * from the reader's point of view.
 */
export function findMarkerRanges(lineText: string, lineFrom = 0): MarkerRange[] {
	if (FENCE.test(lineText)) return [];

	const ranges: MarkerRange[] = [];

	// Leading heading hashes, including the space that follows them. This is
	// the most valuable case: heading text is large, so the shift is largest.
	const heading = /^(#{1,6})(\s)/.exec(lineText);
	if (heading) {
		ranges.push({ from: lineFrom, to: lineFrom + heading[1].length + heading[2].length });
	}

	// Blockquote and list markers are deliberately NOT hidden. They are
	// structural — Notion shows bullets and quote bars too — and Obsidian
	// already keeps the quote marker's width via `color: transparent`, so
	// there is no reflow to fix.

	const start = heading ? heading[0].length : 0;
	const openers = new Map<string, number>();

	let i = start;
	while (i < lineText.length) {
		if (lineText[i] === "\\") {
			i += 2; // escaped character — the next char is literal
			continue;
		}

		// Backtick is handled separately from the PAIRED loop below, rather than
		// through the openers map, because its contents are code and must never
		// be scanned for other markers. `_VARIABLE_A_` inside a code span used to
		// have its underscores paired and hidden like real emphasis, because the
		// generic loop just kept walking character by character through the span.
		if (lineText[i] === "`") {
			const close = lineText.indexOf("`", i + 1);
			if (close === -1) {
				// No closing backtick on this line — literal text, leave it alone.
				i++;
				continue;
			}
			if (close > i + 1) {
				ranges.push({ from: lineFrom + i, to: lineFrom + i + 1 });
				ranges.push({ from: lineFrom + close, to: lineFrom + close + 1 });
			}
			i = close + 1; // skip past the span's contents entirely
			continue;
		}

		const token = PAIRED.find((t) => lineText.startsWith(t, i));
		if (!token) {
			i++;
			continue;
		}

		const openAt = openers.get(token);
		if (openAt === undefined) {
			openers.set(token, i);
		} else {
			// Closing delimiter found — emit both halves and clear the opener.
			// Empty spans like `**` immediately followed by `**` are skipped:
			// there is no content between them, so nothing would reflow.
			if (i > openAt + token.length) {
				ranges.push({ from: lineFrom + openAt, to: lineFrom + openAt + token.length });
				ranges.push({ from: lineFrom + i, to: lineFrom + i + token.length });
			}
			openers.delete(token);
		}
		i += token.length;
	}

	return ranges.sort((a, b) => a.from - b.from);
}
