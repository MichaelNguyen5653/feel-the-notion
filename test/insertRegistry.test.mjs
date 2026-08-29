/**
 * Tests for the insert menu's item table and ordering rules.
 *
 * The rule that matters most: a built-in id missing from a stored order is
 * appended, not dropped. Without it, every user who saved an order before a
 * version that adds a row would silently never see the new row, and there
 * would be no error to notice.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	BUILTIN_ITEMS,
	DEFAULT_INSERT_ORDER,
	resolveMenuItems,
	groupBySection,
	addCustomItem,
	updateCustomItem,
	removeCustomItem,
	setItemHidden,
	resetItemLayout,
	applyOrder,
	matchCommands,
	reorderIds,
} from "./.build/insertRegistry.js";

/** Stands in for t(): returns the key so assertions can name it directly. */
const echo = (key) => key;

const ids = (items) => items.map((i) => i.id);

test("the default order is every built-in, in table order", () => {
	assert.deepEqual(DEFAULT_INSERT_ORDER, BUILTIN_ITEMS.map((i) => i.id));
});

test("every built-in id is unique", () => {
	assert.equal(new Set(DEFAULT_INSERT_ORDER).size, DEFAULT_INSERT_ORDER.length);
});

test("the default table keeps table before toc", () => {
	// Both rows match the query "table". Whichever renders first is what Enter
	// takes, and a table insert pre-empted by a table of contents is the bug
	// this order exists to prevent.
	const order = ids(resolveMenuItems(BUILTIN_ITEMS, [], [], [], echo));
	assert.ok(order.indexOf("table") < order.indexOf("toc"));
});

test("an empty order yields the built-in order", () => {
	assert.deepEqual(ids(resolveMenuItems(BUILTIN_ITEMS, [], [], [], echo)), DEFAULT_INSERT_ORDER);
});

test("a stored order is honoured", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], ["toc", "h1"], [], echo);
	assert.equal(items[0].id, "toc");
	assert.equal(items[1].id, "h1");
});

test("built-ins missing from a stored order are appended, not dropped", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], ["toc"], [], echo);
	assert.equal(items.length, BUILTIN_ITEMS.length);
	assert.equal(items[0].id, "toc");
	assert.ok(ids(items).includes("h1"));
});

test("an unknown id in a stored order is ignored", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], ["gone-in-a-later-version", "h1"], [], echo);
	assert.equal(items[0].id, "h1");
	assert.equal(items.length, BUILTIN_ITEMS.length);
});

test("hidden ids are dropped", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], [], ["h4", "h5"], echo);
	assert.equal(items.length, BUILTIN_ITEMS.length - 2);
	assert.ok(!ids(items).includes("h4"));
});

test("a hidden id that does not exist is harmless", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], [], ["nope"], echo);
	assert.equal(items.length, BUILTIN_ITEMS.length);
});

test("built-in labels come from the translator", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], ["h1"], [], echo);
	assert.equal(items[0].label, "menu.h1");
});

test("custom items carry their own literal label and command", () => {
	const custom = [{ id: "c1", label: "Excalidraw", icon: "pencil", commandId: "excalidraw:new" }];
	const items = resolveMenuItems(BUILTIN_ITEMS, custom, [], [], echo);
	const found = items.find((i) => i.id === "c1");
	assert.equal(found.label, "Excalidraw");
	assert.equal(found.commandId, "excalidraw:new");
	assert.equal(found.sectionKey, "custom");
});

test("custom items are appended after the built-ins by default", () => {
	const custom = [{ id: "c1", label: "X", icon: "pencil", commandId: "x" }];
	const items = resolveMenuItems(BUILTIN_ITEMS, custom, [], [], echo);
	assert.equal(items[items.length - 1].id, "c1");
});

test("a custom item can be ordered among the built-ins", () => {
	const custom = [{ id: "c1", label: "X", icon: "pencil", commandId: "x" }];
	const items = resolveMenuItems(BUILTIN_ITEMS, custom, ["c1", "h1"], [], echo);
	assert.equal(items[0].id, "c1");
	assert.equal(items[1].id, "h1");
});

test("a custom item can be hidden", () => {
	const custom = [{ id: "c1", label: "X", icon: "pencil", commandId: "x" }];
	const items = resolveMenuItems(BUILTIN_ITEMS, custom, [], ["c1"], echo);
	assert.ok(!ids(items).includes("c1"));
});

test("built-in keywords survive resolution", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], ["todo"], [], echo);
	assert.ok(items[0].keywords.includes("checklist"));
});

test("grouping collects consecutive runs of the same section", () => {
	const items = resolveMenuItems(BUILTIN_ITEMS, [], ["h1", "h2", "todo", "h3"], [], echo);
	const sections = groupBySection(items.slice(0, 4));
	assert.deepEqual(sections.map((s) => s.sectionKey), ["headings", "insert", "headings"]);
	assert.deepEqual(ids(sections[0].items), ["h1", "h2"]);
	assert.deepEqual(ids(sections[2].items), ["h3"]);
});

test("grouping an empty list yields no sections", () => {
	assert.deepEqual(groupBySection([]), []);
});

/**
 * Reordering.
 *
 * The rule under test is that a drop means "put the dragged row where the row
 * I dropped on is", in both directions. The index the drop handler reports was
 * measured before the dragged row came out of the array, and forgetting to
 * correct for that is a bug this list has already shipped once (0397fcf).
 */

const ABCD = ["A", "B", "C", "D"];
const joined = (list) => list.join("");

test("dragging down lands the row on its target, not after it", () => {
	assert.equal(joined(reorderIds(ABCD, 0, 2)), "BACD");
});

test("dragging up lands the row on its target", () => {
	assert.equal(joined(reorderIds(ABCD, 3, 1)), "ADBC");
});

test("dragging to the last position", () => {
	assert.equal(joined(reorderIds(ABCD, 0, 3)), "BCAD");
});

test("dragging to the first position", () => {
	assert.equal(joined(reorderIds(ABCD, 3, 0)), "DABC");
});

test("swapping neighbours downward", () => {
	assert.equal(joined(reorderIds(ABCD, 1, 2)), "ABCD");
});

test("a drop on the row itself changes nothing", () => {
	assert.deepEqual(reorderIds(ABCD, 2, 2), ABCD);
});

test("out-of-range indices change nothing", () => {
	// A dataTransfer payload that did not parse arrives as NaN, and a stale
	// index can outlive the list it was measured against.
	assert.deepEqual(reorderIds(ABCD, -1, 2), ABCD);
	assert.deepEqual(reorderIds(ABCD, 4, 2), ABCD);
	assert.deepEqual(reorderIds(ABCD, 1, -1), ABCD);
	assert.deepEqual(reorderIds(ABCD, 1, 4), ABCD);
	assert.deepEqual(reorderIds(ABCD, NaN, 2), ABCD);
});

test("reordering does not mutate the order it was given", () => {
	const original = [...ABCD];
	reorderIds(original, 0, 3);
	assert.deepEqual(original, ABCD);
});

// ── settings mutations ─────────────────────────────────────────────────────
//
// These were inline in the settings tab's DOM event handlers, where each one
// captured the row list built at render time. That was safe only because every
// handler ended by re-rendering the whole tab, which threw the stale captures
// away — and which is exactly the scroll-to-top bug being fixed. Once the list
// repaints in place, the captures survive, so the transitions have to be pure
// functions of the CURRENT layout rather than of whatever was on screen when
// the row was drawn.

const layout = (over = {}) => ({
	insertOrder: [],
	insertHidden: [],
	insertCustom: [],
	...over,
});

const custom = (id, over = {}) => ({
	id,
	label: `Label ${id}`,
	icon: "zap",
	commandId: `cmd:${id}`,
	...over,
});

test("adding a custom item appends it", () => {
	const next = addCustomItem(layout(), custom("c1"));
	assert.deepEqual(next.insertCustom.map((c) => c.id), ["c1"]);
});

test("adding does not mutate the layout it was given", () => {
	const before = layout();
	addCustomItem(before, custom("c1"));
	assert.deepEqual(before.insertCustom, []);
});

test("updating a custom item replaces it by id and keeps position", () => {
	const before = layout({ insertCustom: [custom("c1"), custom("c2")] });
	const next = updateCustomItem(before, custom("c1", { label: "Renamed" }));
	assert.deepEqual(next.insertCustom.map((c) => c.id), ["c1", "c2"]);
	assert.equal(next.insertCustom[0].label, "Renamed");
});

test("updating an id that is not there changes nothing", () => {
	const before = layout({ insertCustom: [custom("c1")] });
	const next = updateCustomItem(before, custom("gone"));
	assert.deepEqual(next.insertCustom.map((c) => c.id), ["c1"]);
});

test("removing a custom item clears it from all three lists", () => {
	// The order and hidden lists both name ids. Leaving a deleted id behind in
	// either one means resolveMenuItems keeps skipping past a row that no
	// longer exists, and the hidden entry would suppress a future custom item
	// that happened to reuse the id.
	const before = layout({
		insertCustom: [custom("c1"), custom("c2")],
		insertOrder: ["c1", "h1", "c2"],
		insertHidden: ["c1", "h1"],
	});
	const next = removeCustomItem(before, "c1");
	assert.deepEqual(next.insertCustom.map((c) => c.id), ["c2"]);
	assert.deepEqual(next.insertOrder, ["h1", "c2"]);
	assert.deepEqual(next.insertHidden, ["h1"]);
});

test("removing a built-in id is refused, since built-ins are hidden not deleted", () => {
	const before = layout({ insertCustom: [custom("c1")], insertOrder: ["h1", "c1"] });
	const next = removeCustomItem(before, "h1");
	assert.deepEqual(next.insertOrder, ["h1", "c1"]);
	assert.deepEqual(next.insertCustom.map((c) => c.id), ["c1"]);
});

test("hiding an item records it once, however many times it is asked", () => {
	let next = setItemHidden(layout(), "h4", true);
	next = setItemHidden(next, "h4", true);
	assert.deepEqual(next.insertHidden, ["h4"]);
});

test("showing an item removes it from hidden", () => {
	const next = setItemHidden(layout({ insertHidden: ["h4", "h5"] }), "h4", false);
	assert.deepEqual(next.insertHidden, ["h5"]);
});

test("resetting clears order and hidden but keeps custom rows", () => {
	// Reset is about layout, not about destroying the commands a user bound.
	const before = layout({
		insertCustom: [custom("c1")],
		insertOrder: ["c1", "h1"],
		insertHidden: ["h1"],
	});
	const next = resetItemLayout(before);
	assert.deepEqual(next.insertOrder, []);
	assert.deepEqual(next.insertHidden, []);
	assert.deepEqual(next.insertCustom.map((c) => c.id), ["c1"]);
});

test("a reorder computed from a stale row list cannot resurrect a deleted id", () => {
	// The scroll-jump fix stops re-rendering the whole tab, so a drag handler
	// still holds the id list from when its row was drawn. If a custom row was
	// deleted in between, that captured list names an id the layout no longer
	// has, and writing it back would leave a phantom entry in insertOrder.
	const afterDelete = removeCustomItem(
		layout({ insertCustom: [custom("c1")], insertOrder: ["h1", "c1", "h2"] }),
		"c1"
	);
	const staleOrder = ["h1", "c1", "h2"];
	const next = applyOrder(afterDelete, staleOrder);
	assert.deepEqual(next.insertOrder, ["h1", "h2"]);
});

// ── command matching ───────────────────────────────────────────────────────
//
// The picker used app.commands.listCommands(), which Obsidian defines as
// Object.values(this.commands).filter(c => !c.checkCallback || c.checkCallback(true)).
// addCommand() synthesises a checkCallback for every editorCallback /
// editorCheckCallback command that returns null when workspace.activeEditor is
// falsy, so listCommands() hides every editor command whenever no editor is
// active. That is most of what anyone would want to bind. The picker now reads
// the full registry instead, and this is the matching that sits in front of it.

const cmd = (id, name) => ({ id, name });

const CMDS = [
	cmd("editor:insert-table", "Insert table"),
	cmd("editor:toggle-bold", "Toggle bold"),
	cmd("excalidraw:new", "Excalidraw: Create new drawing"),
	cmd("templater:insert", "Templater: Insert template"),
	cmd("workspace:split", "Split right"),
];

test("an empty query offers everything", () => {
	assert.equal(matchCommands(CMDS, "").length, CMDS.length);
});

test("matching is case-insensitive", () => {
	assert.deepEqual(matchCommands(CMDS, "INSERT TABLE").map((c) => c.id), ["editor:insert-table"]);
});

test("a plugin's commands are findable by the plugin's name", () => {
	// Obsidian names plugin commands "Plugin: Thing", so the prefix is the
	// only handle a user has on "show me everything Excalidraw can do".
	assert.deepEqual(matchCommands(CMDS, "excalidraw").map((c) => c.id), ["excalidraw:new"]);
});

test("a plugin's commands are also findable by the part after the prefix", () => {
	assert.deepEqual(matchCommands(CMDS, "create new").map((c) => c.id), ["excalidraw:new"]);
});

test("an earlier match outranks a later one", () => {
	// Typing "insert" should put "Insert table" above "Templater: Insert
	// template", because the word the user typed is what that row leads with.
	const ids = matchCommands(CMDS, "insert").map((c) => c.id);
	assert.deepEqual(ids, ["editor:insert-table", "templater:insert"]);
});

test("equal-ranked matches come back alphabetically", () => {
	const same = [cmd("b", "Zebra thing"), cmd("a", "Apple thing")];
	assert.deepEqual(matchCommands(same, "thing").map((c) => c.id), ["a", "b"]);
});

test("the limit caps the result", () => {
	assert.equal(matchCommands(CMDS, "", 2).length, 2);
});

test("the limit keeps the best matches, not the first registered", () => {
	// The old code sliced the registry in registration order, so core commands
	// crowded out every plugin command before ranking ever happened.
	const ids = matchCommands(CMDS, "insert", 1).map((c) => c.id);
	assert.deepEqual(ids, ["editor:insert-table"]);
});

test("a command with no name is skipped rather than throwing", () => {
	const ragged = [{ id: "x" }, cmd("y", "Yes")];
	assert.deepEqual(matchCommands(ragged, "yes").map((c) => c.id), ["y"]);
});

test("nothing matching gives an empty list", () => {
	assert.deepEqual(matchCommands(CMDS, "zzzz"), []);
});
