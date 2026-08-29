/**
 * The insert menu's items, as data.
 *
 * WHY THIS EXISTS
 * The menu used to build its rows from six hard-coded methods, which meant a
 * row's identity and its behaviour were the same object. Nothing could be
 * reordered, hidden, or added without editing the menu class. Splitting the
 * table out leaves the menu owning only the actions, keyed by id.
 *
 * THE ORDERING RULE THAT MATTERS
 * A built-in id absent from a stored order is appended, never dropped. Users
 * who saved an order before a version that adds a row would otherwise never
 * see the new row, with no error anywhere to notice.
 *
 * Pure, and free of both obsidian and the locale helper: labels are resolved
 * through a translate function passed in. See test/insertRegistry.test.mjs.
 */

export type InsertSectionKey = "headings" | "insert" | "inline" | "meta" | "custom";

/** A row the plugin ships. Its action lives in the menu class, keyed by id. */
export interface RegistryItem {
	id: string;
	sectionKey: InsertSectionKey;
	/** Locale key, resolved at render time. */
	labelKey: string;
	icon: string;
	keywords?: string[];
}

/** A row the user added, bound to an Obsidian command. */
export interface CustomInsertItem {
	id: string;
	label: string;
	icon: string;
	commandId: string;
}

/** A row ready to render: label already resolved, order and visibility applied. */
export interface ResolvedItem {
	id: string;
	sectionKey: InsertSectionKey;
	label: string;
	icon: string;
	keywords: string[];
	/** Set on custom rows only. Built-ins run an action keyed by id instead. */
	commandId?: string;
}

export interface ResolvedSection {
	sectionKey: InsertSectionKey;
	items: ResolvedItem[];
}

/**
 * Every row the plugin ships, in its default order.
 *
 * "table" before "toc" is deliberate and load-bearing: both match the query
 * "table", and whichever renders first is what Enter takes.
 *
 * The callout submenu parent is here; the twelve flat callout rows shown
 * while filtering are not, nor is the "Close menu" row, because both are
 * conditional on menu state rather than on settings.
 */
export const BUILTIN_ITEMS: readonly RegistryItem[] = [
	{ id: "h1", sectionKey: "headings", labelKey: "menu.h1", icon: "heading-1", keywords: ["h1", "#1", "title"] },
	{ id: "h2", sectionKey: "headings", labelKey: "menu.h2", icon: "heading-2", keywords: ["h2", "#2", "title"] },
	{ id: "h3", sectionKey: "headings", labelKey: "menu.h3", icon: "heading-3", keywords: ["h3", "#3", "title"] },
	{ id: "h4", sectionKey: "headings", labelKey: "menu.h4", icon: "heading-4", keywords: ["h4", "#4", "title"] },
	{ id: "h5", sectionKey: "headings", labelKey: "menu.h5", icon: "heading-5", keywords: ["h5", "#5", "title"] },

	// "check list" with the space is in the keywords deliberately: the matcher
	// tests the query as one substring, so a two-word query matches nothing
	// unless a keyword contains the space too.
	{ id: "todo", sectionKey: "insert", labelKey: "menu.todo", icon: "check-square", keywords: ["todo", "task", "checkbox", "checklist", "check list", "- [ ]"] },
	{ id: "code", sectionKey: "insert", labelKey: "menu.code", icon: "code", keywords: ["```"] },
	{ id: "math", sectionKey: "insert", labelKey: "menu.math", icon: "sigma", keywords: ["latex", "$$"] },
	{ id: "table", sectionKey: "insert", labelKey: "menu.table", icon: "table" },
	{ id: "divider", sectionKey: "insert", labelKey: "menu.divider", icon: "minus", keywords: ["hr", "---", "rule", "separator", "line", "break"] },
	{ id: "toc", sectionKey: "insert", labelKey: "menu.toc", icon: "list-ordered", keywords: ["toc", "contents", "outline", "headings", "index"] },
	{ id: "callout", sectionKey: "insert", labelKey: "menu.callout", icon: "pencil", keywords: ["admonition"] },

	{ id: "page", sectionKey: "inline", labelKey: "menu.page", icon: "file-plus", keywords: ["note", "subpage", "new"] },
	{ id: "link", sectionKey: "inline", labelKey: "menu.link", icon: "link", keywords: ["wikilink", "[["] },
	{ id: "ext-link", sectionKey: "inline", labelKey: "menu.extLink", icon: "link-2", keywords: ["url"] },
	{ id: "image", sectionKey: "inline", labelKey: "menu.image", icon: "image", keywords: ["photo", "picture"] },
	{ id: "attachment", sectionKey: "inline", labelKey: "menu.attachment", icon: "paperclip", keywords: ["file", "pdf", "upload"] },

	{ id: "today", sectionKey: "meta", labelKey: "menu.today", icon: "calendar", keywords: ["date"] },
	{ id: "yesterday", sectionKey: "meta", labelKey: "menu.yesterday", icon: "calendar-minus", keywords: ["date", "yesterday"] },
	{ id: "tomorrow", sectionKey: "meta", labelKey: "menu.tomorrow", icon: "calendar-plus", keywords: ["date", "tomorrow"] },
	{ id: "time", sectionKey: "meta", labelKey: "menu.time", icon: "clock" },
	{ id: "footnote", sectionKey: "meta", labelKey: "menu.footnote", icon: "hash" },
	{ id: "comment", sectionKey: "meta", labelKey: "menu.comment", icon: "message-square" },
];

export const DEFAULT_INSERT_ORDER: string[] = BUILTIN_ITEMS.map((item) => item.id);

/**
 * The rows to render, ordered and filtered.
 *
 * `order` names ids in the sequence the user chose. Anything in the pool it
 * does not name is appended in pool order, which is how a version that adds a
 * built-in reaches a user who has already saved an order.
 */
export function resolveMenuItems(
	builtins: readonly RegistryItem[],
	custom: readonly CustomInsertItem[],
	order: readonly string[],
	hidden: readonly string[],
	translate: (key: string) => string
): ResolvedItem[] {
	const pool = new Map<string, ResolvedItem>();

	for (const item of builtins) {
		pool.set(item.id, {
			id: item.id,
			sectionKey: item.sectionKey,
			label: translate(item.labelKey),
			icon: item.icon,
			keywords: item.keywords ?? [],
		});
	}

	for (const item of custom) {
		pool.set(item.id, {
			id: item.id,
			sectionKey: "custom",
			label: item.label,
			icon: item.icon,
			keywords: [],
			commandId: item.commandId,
		});
	}

	const hiddenSet = new Set(hidden);
	const placed = new Set<string>();
	const result: ResolvedItem[] = [];

	for (const id of order) {
		const item = pool.get(id);
		// An id from a version that no longer ships it. Skipping quietly is
		// right: it is stale settings data, not a user error.
		if (!item || placed.has(id)) continue;
		placed.add(id);
		if (!hiddenSet.has(id)) result.push(item);
	}

	for (const [id, item] of pool) {
		if (placed.has(id)) continue;
		if (!hiddenSet.has(id)) result.push(item);
	}

	return result;
}

/**
 * `order` with the id at `from` moved to sit where the id at `to` was.
 *
 * WHY THIS IS NOT INLINE IN THE DROP HANDLER ANY MORE
 * The correction below has already shipped one off-by-one. `to` names a
 * position in the array as it was BEFORE the dragged id came out of it, so
 * once it is spliced out, everything after it has shifted up by one. Without
 * the adjustment a downward drag lands the row after its target while an
 * upward drag lands before it — and the user asked for the same thing both
 * times. That is a rule worth a test, and a test needs a function.
 *
 * Indices outside the array, or equal to each other, are a no-op: nothing was
 * asked for, so nothing changes.
 */
export function reorderIds(order: readonly string[], from: number, to: number): string[] {
	const next = [...order];
	if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
	if (from === to) return next;
	if (from < 0 || from >= order.length) return next;
	if (to < 0 || to >= order.length) return next;

	const [moved] = next.splice(from, 1);
	next.splice(to - (from < to ? 1 : 0), 0, moved);
	return next;
}

/** Consecutive runs of the same section, so reordering moves headers with rows. */
export function groupBySection(items: readonly ResolvedItem[]): ResolvedSection[] {
	const sections: ResolvedSection[] = [];

	for (const item of items) {
		const last = sections[sections.length - 1];
		if (last && last.sectionKey === item.sectionKey) {
			last.items.push(item);
		} else {
			sections.push({ sectionKey: item.sectionKey, items: [item] });
		}
	}

	return sections;
}

/**
 * The three settings the insert-menu list owns.
 *
 * WHY THESE TRANSITIONS ARE PURE FUNCTIONS
 * They used to be inline in the settings tab's DOM event handlers, and each
 * handler captured the row list built when its row was drawn. That was only
 * safe because every handler finished by re-rendering the whole tab, throwing
 * the stale captures away — which is precisely what scrolled the user back to
 * the top on every add, edit, delete, reorder and reset.
 *
 * Once the list repaints in place, those captures survive. So each transition
 * takes the CURRENT layout and returns a new one, and none of them trusts a
 * list that arrived from the DOM.
 */
export interface InsertLayout {
	insertOrder: string[];
	insertHidden: string[];
	insertCustom: CustomInsertItem[];
}

/** Ids the plugin ships, which can be hidden and reordered but never deleted. */
const BUILTIN_IDS = new Set(BUILTIN_ITEMS.map((item) => item.id));

export function addCustomItem(layout: InsertLayout, item: CustomInsertItem): InsertLayout {
	return { ...layout, insertCustom: [...layout.insertCustom, item] };
}

export function updateCustomItem(layout: InsertLayout, item: CustomInsertItem): InsertLayout {
	return {
		...layout,
		insertCustom: layout.insertCustom.map((entry) => (entry.id === item.id ? item : entry)),
	};
}

/**
 * Deletes a custom row and every trace of its id.
 *
 * A built-in is refused outright: built-ins are hidden, never deleted, and
 * dropping one from insertOrder here would silently move it to the end of the
 * menu instead.
 */
export function removeCustomItem(layout: InsertLayout, id: string): InsertLayout {
	if (BUILTIN_IDS.has(id)) return layout;

	return {
		insertCustom: layout.insertCustom.filter((entry) => entry.id !== id),
		// Leaving the id in either list would keep resolveMenuItems skipping a
		// row that no longer exists, and a stale hidden entry would suppress a
		// future custom item that happened to reuse the id.
		insertOrder: layout.insertOrder.filter((entry) => entry !== id),
		insertHidden: layout.insertHidden.filter((entry) => entry !== id),
	};
}

export function setItemHidden(layout: InsertLayout, id: string, hidden: boolean): InsertLayout {
	const without = layout.insertHidden.filter((entry) => entry !== id);
	return { ...layout, insertHidden: hidden ? [...without, id] : without };
}

/** Clears the layout without destroying the commands the user bound. */
export function resetItemLayout(layout: InsertLayout): InsertLayout {
	return { ...layout, insertOrder: [], insertHidden: [] };
}

/**
 * Writes a new order, dropping ids the layout no longer has.
 *
 * The order arrives from a drag handler that captured it when its row was
 * drawn, so it can name a custom row deleted since. Writing it back verbatim
 * would leave a phantom id in insertOrder.
 */
export function applyOrder(layout: InsertLayout, order: readonly string[]): InsertLayout {
	const live = new Set<string>([...BUILTIN_IDS, ...layout.insertCustom.map((entry) => entry.id)]);
	return { ...layout, insertOrder: order.filter((id) => live.has(id)) };
}

/** The shape of an Obsidian command this module needs. */
export interface PickableCommand {
	id: string;
	name?: string;
}

/** Rows the command picker offers, ranked. */
export const COMMAND_PICKER_LIMIT = 200;

/**
 * Ranked substring match over command names.
 *
 * WHY RANKING, AND WHY A LIMIT THAT COMES LAST
 * The picker used to filter and then take the first 50 in registry order,
 * which is registration order: core commands first, every plugin after. A
 * short query therefore filled all 50 slots with core commands and the
 * plugin command the user was looking for was never on screen. Ranking first
 * and cutting last means the limit trims the worst matches rather than the
 * most recently installed plugin.
 *
 * Obsidian names plugin commands "Plugin: Thing", so a plain substring test
 * over the whole name lets the user search by the plugin, by the action, or
 * by both. An earlier match position wins, because the word someone typed is
 * usually the word the row they want leads with.
 */
export function matchCommands<T extends PickableCommand>(
	commands: readonly T[],
	query: string,
	limit: number = COMMAND_PICKER_LIMIT
): T[] {
	const needle = query.trim().toLowerCase();

	const scored: { command: T; at: number; name: string }[] = [];
	for (const command of commands) {
		// A command with no name cannot be offered by name, and one has been
		// seen in the wild from a half-registered plugin.
		if (!command.name) continue;
		const name = command.name.toLowerCase();
		const at = needle === "" ? 0 : name.indexOf(needle);
		if (at === -1) continue;
		scored.push({ command, at, name });
	}

	scored.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));

	return scored.slice(0, limit).map((entry) => entry.command);
}
