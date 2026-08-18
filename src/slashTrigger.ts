/**
 * When the slash menu opens, what it filters on, and when it gives up.
 *
 * Pure, so the trigger rules can be tested without typing into an editor.
 * See test/slashTrigger.test.mjs.
 */

/**
 * True when the trigger character should open the menu.
 *
 * On an empty block always — the same rule Notion uses. Indentation, a list
 * marker and a callout's `>` do not count as content, so an empty nested
 * bullet and an empty line inside an `> [!info]` block both work.
 *
 * `allowInline` extends it to the middle of a line, and the guard there is
 * that the trigger must follow whitespace. That is what keeps a `/` inside
 * ordinary prose quiet: "and/or", "https://example.com", "12/07" all have a
 * non-space character in front of the slash and none of them opens a menu,
 * while "note: /" does.
 */
export function isSlashTriggerPosition(textBeforeTrigger: string, allowInline = false): boolean {
	if (stripMarkers(textBeforeTrigger).trim().length === 0) return true;
	if (!allowInline) return false;
	return /\s$/.test(textBeforeTrigger);
}

/** One leading marker: a quote level, a bullet, a task box, a number. */
const MARKER = /^[ \t]*(?:>[ \t]*|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/;

/**
 * Drops the structure a line opens with, leaving whatever the user typed.
 *
 * An empty bullet, an empty numbered item and an empty callout body line are
 * all empty blocks as far as the reader is concerned, so the trigger has to
 * work on them. Looping handles nesting: `> > ` and `- [ ] ` are two markers.
 */
function stripMarkers(text: string): string {
	let out = text;
	for (;;) {
		const next = out.replace(MARKER, "");
		if (next === out) return out;
		out = next;
	}
}

/**
 * The text typed after the trigger, or null when the menu should close.
 *
 * Null means the caret has moved back to or before the trigger, or off the
 * line entirely — in both cases the query no longer exists.
 */
export function readSlashQuery(
	lineText: string,
	triggerCol: number,
	caretCol: number,
	trigger: string
): string | null {
	if (caretCol <= triggerCol) return null;
	if (lineText[triggerCol] !== trigger) return null;
	return lineText.slice(triggerCol + trigger.length, caretCol);
}

/**
 * Whether a menu entry survives the current query.
 *
 * Matching runs over the label and its keywords rather than the label alone,
 * so "h1" finds "Heading 1" — the shorthand is what actually gets typed.
 */
export function matchesQuery(query: string, label: string, keywords: string[] = []): boolean {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return true;
	return [label, ...keywords].some((candidate) => candidate.toLowerCase().includes(q));
}

/** Normalises the configured trigger to a single character, or null if unset. */
export function normaliseTrigger(raw: string | undefined): string | null {
	const trimmed = (raw ?? "").trim();
	if (trimmed.length === 0) return null;
	return Array.from(trimmed)[0] ?? null;
}
