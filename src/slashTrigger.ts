/**
 * When the slash menu opens, what it filters on, and when it gives up.
 *
 * Pure, so the trigger rules can be tested without typing into an editor.
 * See test/slashTrigger.test.mjs.
 */

/**
 * True when the trigger character should open the menu.
 *
 * Only on an otherwise empty block — the same rule Notion uses. Triggering
 * mid-sentence would mean a `/` in ordinary prose ("and/or", a URL, a date)
 * popped a menu over the text being written, and it would leave the insert
 * with no sensible place to land: half the entries are whole blocks.
 * Indentation does not count as content, so an empty nested bullet still works.
 */
export function isSlashTriggerPosition(textBeforeTrigger: string): boolean {
	return textBeforeTrigger.trim().length === 0;
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
