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
