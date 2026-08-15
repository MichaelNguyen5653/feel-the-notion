/**
 * Tests for menu placement.
 *
 * The rule being protected: a menu goes below its anchor or above it, never
 * across it. Clamping a too-tall menu into the window is the obvious
 * implementation and it is the bug — it slid the insert menu over the line
 * being typed, so the filter worked but the user was typing blind.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { placeMenu, placeSubmenu } from "./.build/menuPosition.js";

const VIEWPORT = { viewportWidth: 1400, viewportHeight: 900 };

/** A caret line 20px tall, with the menu anchored 6px below it. */
function atLine(lineTop, menuHeight = 300, menuWidth = 236) {
	return placeMenu({
		anchorX: 400,
		anchorY: lineTop + 20 + 6,
		avoidTop: lineTop,
		menuWidth,
		menuHeight,
		...VIEWPORT,
	});
}

test("a menu with room goes below the line", () => {
	const out = atLine(100);
	assert.equal(out.top, 126, "directly below the anchor");
});

test("a menu without room below flips above the line", () => {
	const out = atLine(800);
	assert.ok(out.top < 800, "must start above the line");
	assert.ok(out.top + out.maxHeight <= 800, "and end before it");
});

test("the menu never covers the line it is anchored to", () => {
	// The reported bug, as a property: walk the line down the whole viewport
	// and assert the menu and the line never overlap.
	for (let lineTop = 0; lineTop <= 880; lineTop += 20) {
		const lineBottom = lineTop + 20;
		const out = atLine(lineTop);
		const height = Math.min(300, out.maxHeight);
		const clearsBelow = out.top >= lineBottom;
		const clearsAbove = out.top + height <= lineTop;
		assert.ok(
			clearsBelow || clearsAbove,
			`line at ${lineTop}: menu ${out.top}..${out.top + height} overlaps ${lineTop}..${lineBottom}`
		);
	}
});

test("the menu stays inside the viewport", () => {
	for (let lineTop = 0; lineTop <= 880; lineTop += 20) {
		const out = atLine(lineTop);
		assert.ok(out.top >= 8, `top ${out.top} must clear the window edge`);
		assert.ok(out.top + out.maxHeight <= 900, "bottom must stay on screen");
	}
});

test("height is capped so a long list scrolls rather than overflowing", () => {
	const out = placeMenu({
		anchorX: 0,
		anchorY: 100,
		avoidTop: 80,
		menuWidth: 236,
		menuHeight: 2000,
		...VIEWPORT,
	});
	assert.equal(out.maxHeight, 300, "never taller than the cap");
});

test("a short menu is not stretched to the cap", () => {
	const out = atLine(100, 120);
	assert.equal(out.top, 126, "placement is unaffected by the cap");
});

test("a cramped anchor keeps a usable minimum height", () => {
	// Both sides tiny: the menu scrolls rather than collapsing to a sliver.
	const out = placeMenu({
		anchorX: 0,
		anchorY: 60,
		avoidTop: 40,
		menuWidth: 236,
		menuHeight: 300,
		viewportWidth: 1400,
		viewportHeight: 100,
	});
	assert.equal(out.maxHeight, 120);
});

test("ties go below, so the menu holds still while a query is typed", () => {
	// Equal space each way. Filtering changes the menu's height on every
	// keystroke; anchoring the top keeps it from jittering up and down.
	const out = placeMenu({
		anchorX: 0,
		anchorY: 450,
		avoidTop: 450,
		menuWidth: 236,
		menuHeight: 900,
		...VIEWPORT,
	});
	assert.equal(out.top, 450);
});

// ── horizontal ─────────────────────────────────────────────────────────────

test("a menu near the right edge is pulled back on screen", () => {
	const out = placeMenu({
		anchorX: 1350,
		anchorY: 100,
		avoidTop: 80,
		menuWidth: 236,
		menuHeight: 200,
		...VIEWPORT,
	});
	assert.equal(out.left, 1400 - 236 - 8);
});

test("a menu wider than the viewport is pinned to the left edge", () => {
	const out = placeMenu({
		anchorX: 100,
		anchorY: 100,
		avoidTop: 80,
		menuWidth: 2000,
		menuHeight: 200,
		...VIEWPORT,
	});
	assert.equal(out.left, 8);
});

// ── submenus ───────────────────────────────────────────────────────────────

test("a submenu sits to the right of its parent", () => {
	const out = placeSubmenu({
		parentLeft: 400,
		parentRight: 636,
		parentTop: 200,
		menuWidth: 236,
		menuHeight: 300,
		...VIEWPORT,
	});
	assert.deepEqual(out, { top: 200, left: 642 });
});

test("a submenu with no room on the right flips to the left", () => {
	const out = placeSubmenu({
		parentLeft: 1100,
		parentRight: 1336,
		parentTop: 200,
		menuWidth: 236,
		menuHeight: 300,
		...VIEWPORT,
	});
	assert.equal(out.left, 1100 - 236 - 6);
});

test("a submenu is lifted when it would run off the bottom", () => {
	const out = placeSubmenu({
		parentLeft: 400,
		parentRight: 636,
		parentTop: 800,
		menuWidth: 236,
		menuHeight: 300,
		...VIEWPORT,
	});
	assert.equal(out.top, 900 - 300 - 8);
});
