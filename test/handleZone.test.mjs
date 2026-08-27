/**
 * Tests for handle placement and its hover zone.
 *
 * The rule being protected: the zone is generous on the side the handle is
 * actually rendered on and tight on the other. The old test allowed 100px on
 * both sides, which was simultaneously too mean on the handle's side (a
 * diagonal move from text to handle could leave the zone) and pointless on
 * the side where nothing is drawn.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	isInsideHandleZone,
	handleOffsetX,
	HANDLE_SIDE_SLACK,
	OPPOSITE_SIDE_SLACK,
	HANDLE_LEFT_GAP,
	HANDLE_RIGHT_GAP,
	HANDLE_ROW_WIDTH,
} from "./.build/handleZone.js";

/** An editor 800px wide with 700px of content inset 50px from its left edge. */
const M = {
	viewWidth: 800,
	viewHeight: 600,
	contentOffsetLeft: 50,
	contentWidth: 700,
};

test("a pointer over the text is inside the zone on either side", () => {
	assert.equal(isInsideHandleZone(M, 400, 300, "left"), true);
	assert.equal(isInsideHandleZone(M, 400, 300, "right"), true);
});

test("the handle's own side allows a wide excursion", () => {
	assert.equal(isInsideHandleZone(M, -HANDLE_SIDE_SLACK, 300, "left"), true);
	assert.equal(isInsideHandleZone(M, -HANDLE_SIDE_SLACK - 1, 300, "left"), false);

	const rightEdge = M.viewWidth + HANDLE_SIDE_SLACK;
	assert.equal(isInsideHandleZone(M, rightEdge, 300, "right"), true);
	assert.equal(isInsideHandleZone(M, rightEdge + 1, 300, "right"), false);
});

test("the opposite side allows only a sliver", () => {
	assert.equal(isInsideHandleZone(M, -OPPOSITE_SIDE_SLACK, 300, "right"), true);
	assert.equal(isInsideHandleZone(M, -OPPOSITE_SIDE_SLACK - 1, 300, "right"), false);

	const rightEdge = M.viewWidth + OPPOSITE_SIDE_SLACK;
	assert.equal(isInsideHandleZone(M, rightEdge, 300, "left"), true);
	assert.equal(isInsideHandleZone(M, rightEdge + 1, 300, "left"), false);
});

test("the slack on the handle's side clears the handle itself", () => {
	// Otherwise the pointer leaves the zone while it is still on the button.
	assert.ok(HANDLE_SIDE_SLACK > HANDLE_LEFT_GAP);
});

test("vertical bounds are the editor's, on both sides", () => {
	for (const side of ["left", "right"]) {
		assert.equal(isInsideHandleZone(M, 400, -1, side), false);
		assert.equal(isInsideHandleZone(M, 400, 0, side), true);
		assert.equal(isInsideHandleZone(M, 400, M.viewHeight, side), true);
		assert.equal(isInsideHandleZone(M, 400, M.viewHeight + 1, side), false);
	}
});

test("left places the handle in the gutter before the content", () => {
	assert.equal(handleOffsetX(M, "left"), 50 - HANDLE_LEFT_GAP);
});

/** Readable line length on: 700px of content centred in a 1400px editor. */
const WIDE = {
	viewWidth: 1400,
	viewHeight: 600,
	contentOffsetLeft: 350,
	contentWidth: 700,
};

test("right places the handle past the content's far edge", () => {
	// 350 + 700 + 12 = 1062, and the row ends at 1130, well inside 1400.
	assert.equal(handleOffsetX(WIDE, "right"), 350 + 700 + HANDLE_RIGHT_GAP);
});

test("right is clamped back inside a view the content nearly fills", () => {
	// M's content ends at 750 in an 800px editor, so the unclamped position
	// would push most of the row past the right edge — readable line length
	// off, or a narrow sidebar.
	const x = handleOffsetX(M, "right");
	assert.ok(x < M.contentOffsetLeft + M.contentWidth + HANDLE_RIGHT_GAP);
	assert.ok(x + HANDLE_ROW_WIDTH <= M.viewWidth);
});
