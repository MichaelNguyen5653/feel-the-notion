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

/**
 * Width of the whole handle row: three 20px buttons with two 4px gaps.
 *
 * The row grows away from its anchor, so every placement has to budget for
 * the full width even when the "+" or the chevron is currently switched off —
 * both can reappear without the handle moving.
 */
export const HANDLE_ROW_WIDTH = 68;

/**
 * Gutter width between the content and a left-side handle.
 *
 * Must clear HANDLE_ROW_WIDTH, because a left-side handle is anchored at its
 * own left edge and grows rightward, toward the text. At the old value of 52,
 * tuned when the row was two buttons wide, the third button pushed the grip
 * over the first stretch of the hovered line and it swallowed clicks meant for
 * the caret. The remainder is breathing room between the grip and the text.
 */
export const HANDLE_LEFT_GAP = 76;

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

/**
 * The handle's left position, in the scroller's coordinate space.
 *
 * The right side is clamped so the whole row stays inside the view. Without
 * the clamp, any layout where the content nearly fills its editor — readable
 * line length switched off, a narrow sidebar, a split pane — put the row past
 * the right edge, where it either forced horizontal overflow or was simply
 * not there, and the side setting read as broken.
 *
 * The left side is deliberately NOT clamped to zero. A left-side handle lives
 * in the gutter, which is outside the content box by design, and on a narrow
 * editor that gutter legitimately starts left of the scroller's origin;
 * clamping would drag the row back on top of the text instead.
 */
export function handleOffsetX(m: ZoneMetrics, side: HandleSide): number {
	if (side !== "right") return m.contentOffsetLeft - HANDLE_LEFT_GAP;

	const past = m.contentOffsetLeft + m.contentWidth + HANDLE_RIGHT_GAP;
	return Math.min(past, m.viewWidth - HANDLE_ROW_WIDTH - 4);
}
