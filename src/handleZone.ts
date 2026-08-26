/**
 * Where the block handle sits, and how far the pointer may stray before it
 * counts as having left.
 *
 * WHY THIS IS ITS OWN MODULE
 * Both decisions used to be literals inside blockHandles.ts: a symmetric
 * `x < -100 || x > viewWidth + 100` test and a hard-coded `- 52` offset.
 * Neither could be tested without an editor, and neither knew which side the
 * handle was actually drawn on. Pulling them out makes the geometry testable
 * and makes the side a parameter rather than an assumption.
 *
 * Pure. See test/handleZone.test.mjs.
 */

export type HandleSide = "left" | "right";

/**
 * Editor geometry the placement needs. A subset of blockHandles' own Metrics,
 * named separately so this module does not depend on the view.
 */
export interface ZoneMetrics {
	viewWidth: number;
	viewHeight: number;
	/** Offset of the content inside the scroller. */
	contentOffsetLeft: number;
	contentWidth: number;
}

/** Gutter width between the content and a left-side handle. */
export const HANDLE_LEFT_GAP = 52;

/** Gap between the content's far edge and a right-side handle. */
export const HANDLE_RIGHT_GAP = 12;

/**
 * How far past the editor's edge the pointer may stray on the handle's side.
 *
 * It has to clear HANDLE_LEFT_GAP plus the handle's own width, with enough
 * left over that a diagonal move from the text to the button never crosses
 * out of the zone and hides the thing being reached for.
 */
export const HANDLE_SIDE_SLACK = 160;

/**
 * The same allowance on the side with no handle on it.
 *
 * Small but not zero: a pointer skimming the far margin is still reading the
 * line it is beside, and hiding the handle there would be a flicker.
 */
export const OPPOSITE_SIDE_SLACK = 20;

/** True while the pointer is close enough for the handle to stay up. */
export function isInsideHandleZone(
	m: ZoneMetrics,
	x: number,
	y: number,
	side: HandleSide
): boolean {
	if (y < 0 || y > m.viewHeight) return false;

	const leftSlack = side === "left" ? HANDLE_SIDE_SLACK : OPPOSITE_SIDE_SLACK;
	const rightSlack = side === "right" ? HANDLE_SIDE_SLACK : OPPOSITE_SIDE_SLACK;

	return x >= -leftSlack && x <= m.viewWidth + rightSlack;
}

/** The handle's left position, in the scroller's coordinate space. */
export function handleOffsetX(m: ZoneMetrics, side: HandleSide): number {
	return side === "right"
		? m.contentOffsetLeft + m.contentWidth + HANDLE_RIGHT_GAP
		: m.contentOffsetLeft - HANDLE_LEFT_GAP;
}
