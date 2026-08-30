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

/** Ends a bare URL: whitespace, or a delimiter that is closing something else. */
const URL_END = /[\s)\]>]/;

/**
 * Length of the link construct starting at `i`, or 0 when there is none.
 *
 * WHY LINKS ARE SKIPPED WHOLE
 * The scanner walked straight through link syntax, so a paired `_` or `*`
 * anywhere inside a URL or a note name was read as emphasis and hidden. A
 * wikipedia link showed as ".../Foo bar baz" while being edited: the reader
 * could not see their own URL. Markdown does not treat those underscores as
 * emphasis either, so hiding them was wrong on the spec as much as on the eye.
 *
 * Both halves are skipped, not just the destination. Link text is where note
 * names live, and `[my_page_name](...)` has the same problem as the URL does.
 *
 * Anything that does not close is not a link. A stray `[` is ordinary text,
 * and treating it as an opener would silently switch marker hiding off for
 * the rest of the line.
 */
function linkLength(text: string, i: number): number {
	// Obsidian wikilinks and embeds: [[note]], [[note|alias]], ![[embed]].
	const wiki = text.startsWith("![[", i) ? 3 : text.startsWith("[[", i) ? 2 : 0;
	if (wiki > 0) {
		const close = text.indexOf("]]", i + wiki);
		return close === -1 ? 0 : close + 2 - i;
	}

	// Inline links and images: [text](dest), ![alt](dest).
	const bracketAt = text.startsWith("![", i) ? i + 1 : text[i] === "[" ? i : -1;
	if (bracketAt !== -1) {
		// Counted rather than searched for the first "]", so an image nested in
		// a link — [![alt](img)](href) — closes at the outer bracket.
		let depth = 0;
		let j = bracketAt;
		for (; j < text.length; j++) {
			if (text[j] === "\\") { j++; continue; }
			if (text[j] === "[") depth++;
			else if (text[j] === "]" && --depth === 0) break;
		}
		if (depth !== 0 || text[j + 1] !== "(") return 0;

		let open = 0;
		let k = j + 1;
		for (; k < text.length; k++) {
			if (text[k] === "\\") { k++; continue; }
			if (text[k] === "(") open++;
			else if (text[k] === ")" && --open === 0) break;
		}
		return open === 0 ? k + 1 - i : 0;
	}

	// Angle autolink: <https://example.com>. The scheme test keeps ordinary
	// prose like "a < b > c" out of it.
	if (text[i] === "<") {
		const close = text.indexOf(">", i + 1);
		if (close === -1) return 0;
		return /^<[a-z][a-z0-9+.-]*:/i.test(text.slice(i, close + 1)) ? close + 1 - i : 0;
	}

	// Bare URL. Matched by prefix rather than by slicing the rest of the line,
	// which would allocate a substring at every character of a long line.
	if (text.startsWith("http://", i) || text.startsWith("https://", i)) {
		let end = i;
		while (end < text.length && !URL_END.test(text[end])) end++;
		return end - i;
	}

	return 0;
}

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

		// Links are skipped whole, for the same reason code spans are: their
		// contents are not emphasis, and pairing markers inside them hides
		// characters the reader needs to see.
		const link = linkLength(lineText, i);
		if (link > 0) {
			i += link;
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
