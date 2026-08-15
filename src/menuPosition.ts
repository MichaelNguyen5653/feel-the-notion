/**
 * Where a floating menu goes.
 *
 * Shared by both menus rather than written twice. The insert menu had this
 * fixed and the action menu did not, which is precisely what duplicated
 * positioning code does — one copy gets the fix.
 *
 * Pure. See test/menuPosition.test.mjs.
 */

/** Gap between the menu and the window edge. */
const PADDING = 8;
/** Gap between the menu and the thing it is anchored to. */
const GAP = 6;
/** The menu sits beside the text; it is not meant to stand in for the page. */
const MAX_HEIGHT = 300;
/** Below this a menu is a sliver, so it scrolls instead of shrinking further. */
const MIN_HEIGHT = 120;

export interface MenuPlacementInput {
	/** Preferred top-left, already offset below the anchor. */
	anchorX: number;
	anchorY: number;
	/** Top of what must not be covered — the caret's line, or the button. */
	avoidTop: number;
	/** The menu's natural size, measured with no height cap applied. */
	menuWidth: number;
	menuHeight: number;
	viewportWidth: number;
	viewportHeight: number;
}

export interface MenuPlacement {
	top: number;
	left: number;
	maxHeight: number;
}

/**
 * Places a menu below its anchor, or above it when it will not fit — never
 * across it.
 *
 * Clamping a too-tall menu into the window, which is the obvious
 * implementation, slides it straight over whatever it was anchored to. For the
 * insert menu that was the line being typed: the filter still worked, but the
 * user could not see what they were typing.
 */
export function placeMenu(input: MenuPlacementInput): MenuPlacement {
	const spaceBelow = input.viewportHeight - PADDING - input.anchorY;
	const spaceAbove = input.avoidTop - GAP - PADDING;

	// Ties go below: it is the reading direction, and it keeps the menu still
	// when the list grows or shrinks as a query is typed.
	const placeBelow = input.menuHeight <= spaceBelow || spaceBelow >= spaceAbove;

	const maxHeight = Math.min(
		MAX_HEIGHT,
		Math.max(MIN_HEIGHT, placeBelow ? spaceBelow : spaceAbove)
	);
	const height = Math.min(input.menuHeight, maxHeight);

	const top = placeBelow
		? input.anchorY
		: Math.max(PADDING, input.avoidTop - GAP - height);

	let left = input.anchorX;
	if (left + input.menuWidth > input.viewportWidth - PADDING) {
		left = Math.max(PADDING, input.viewportWidth - input.menuWidth - PADDING);
	}

	return { top, left, maxHeight };
}

export interface SubmenuPlacementInput {
	parentLeft: number;
	parentRight: number;
	parentTop: number;
	menuWidth: number;
	menuHeight: number;
	viewportWidth: number;
	viewportHeight: number;
}

/** Places a submenu beside its parent, flipping to the left when it overflows. */
export function placeSubmenu(input: SubmenuPlacementInput): { top: number; left: number } {
	let left = input.parentRight + GAP;
	if (left + input.menuWidth > input.viewportWidth - PADDING) {
		left = Math.max(PADDING, input.parentLeft - input.menuWidth - GAP);
	}

	let top = input.parentTop;
	if (top + input.menuHeight > input.viewportHeight - PADDING) {
		top = Math.max(PADDING, input.viewportHeight - input.menuHeight - PADDING);
	}

	return { top, left };
}
