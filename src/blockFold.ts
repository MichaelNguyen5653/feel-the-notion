import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { Extension, StateEffect, StateField } from "@codemirror/state";
import { foldableRange } from "./foldRange";
import { t } from "./locale/helpers";

/**
 * Notion-style block folding.
 *
 * WHY A StateField AND NOT A ViewPlugin
 * Every other decoration in this plugin is a ViewPlugin. This one cannot be.
 * A fold replaces a range that spans line breaks, which changes the editor's
 * vertical block structure, and CodeMirror does not support decorations that
 * do that being provided from a view plugin. Fold state also has to survive
 * viewport changes, which a view plugin's rebuilt decorations would not.
 *
 * WHAT IS FOLDED
 * The range from the end of the block's first line to the end of its last.
 * The first line stays visible and the ellipsis sits at its end, which is the
 * shape the reporter asked for.
 *
 * NEVER TOUCHES THE DOCUMENT
 * A fold is decoration only, so a folded block still drags, transforms,
 * copies and deletes whole, and nothing about a fold reaches the file on
 * disk. Folds are per-editor and are gone when the note is reopened.
 */

/** Folds the range [from, to). Positions are document offsets. */
export const foldBlockEffect = StateEffect.define<{ from: number; to: number }>();

/** Releases the fold that starts exactly at `from`. */
export const unfoldBlockEffect = StateEffect.define<{ from: number }>();

class FoldEllipsisWidget extends WidgetType {
	toDOM(view: EditorView): HTMLElement {
		const el = document.createElement("span");
		el.className = "ftn-fold-ellipsis";
		el.textContent = "…";
		el.setAttribute("aria-label", t("fold.expand"));

		// mousedown rather than click: the editor takes the click to place a
		// caret, and by then the widget it was aimed at is gone.
		el.addEventListener("mousedown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const pos = view.posAtDOM(el);
			view.dispatch({ effects: unfoldBlockEffect.of({ from: pos }) });
		});

		return el;
	}

	// Every ellipsis is identical, so CodeMirror may reuse the DOM freely.
	eq(): boolean {
		return true;
	}

	// The widget handles its own mousedown; without this CodeMirror would
	// swallow the event before the listener above ever ran.
	ignoreEvent(): boolean {
		return false;
	}
}

const foldMark = Decoration.replace({ widget: new FoldEllipsisWidget() });

export const foldField = StateField.define<DecorationSet>({
	create: () => Decoration.none,

	update(folds, tr) {
		folds = folds.map(tr.changes);

		for (const effect of tr.effects) {
			if (effect.is(foldBlockEffect)) {
				folds = folds.update({
					add: [foldMark.range(effect.value.from, effect.value.to)],
				});
			}
			if (effect.is(unfoldBlockEffect)) {
				const target = effect.value.from;
				folds = folds.update({ filter: (from) => from !== target });
			}
		}

		if (tr.docChanged) {
			// An edit inside a folded range means the hidden text no longer has
			// the shape the fold was taken of. Releasing it is the honest
			// outcome: the alternative is an ellipsis standing over content the
			// user cannot see and did not mean to hide.
			const doomed: number[] = [];
			tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
				folds.between(fromB, toB, (from) => {
					doomed.push(from);
				});
			});
			if (doomed.length > 0) {
				folds = folds.update({ filter: (from) => !doomed.includes(from) });
			}
		}

		// A fold whose content was deleted outright maps to an empty range,
		// which would render an ellipsis hiding nothing.
		return folds.update({ filter: (from, to) => to > from });
	},

	provide: (field) => EditorView.decorations.from(field),
});

/** The fold starting exactly at `from`, or null. */
function foldAt(folds: DecorationSet, from: number): { from: number; to: number } | null {
	let found: { from: number; to: number } | null = null;
	folds.between(from, from, (start, end) => {
		if (start === from) {
			found = { from: start, to: end };
			return false;
		}
	});
	return found;
}

/** Document offsets a fold at `lineNo` would cover, or null. */
function foldOffsets(view: EditorView, lineNo: number): { from: number; to: number } | null {
	const range = foldableRange(view.state.doc, lineNo);
	if (!range) return null;
	return {
		from: view.state.doc.line(range.headLine).to,
		to: view.state.doc.line(range.lastLine).to,
	};
}

export function isFoldedAtLine(view: EditorView, lineNo: number): boolean {
	const folds = view.state.field(foldField, false);
	if (!folds) return false;
	const offsets = foldOffsets(view, lineNo);
	return offsets !== null && foldAt(folds, offsets.from) !== null;
}

/** Folds or unfolds the block at `lineNo`. Returns false when it is not foldable. */
export function toggleFoldAtLine(view: EditorView, lineNo: number): boolean {
	const folds = view.state.field(foldField, false);
	if (!folds) return false;

	const offsets = foldOffsets(view, lineNo);
	if (!offsets) return false;

	const existing = foldAt(folds, offsets.from);
	view.dispatch({
		effects: existing
			? unfoldBlockEffect.of({ from: existing.from })
			: foldBlockEffect.of(offsets),
	});
	return true;
}

export function blockFoldExtension(): Extension[] {
	return [
		foldField,
		// Without this the caret still visits the hidden positions, so arrowing
		// past a folded block appears to stall with nothing moving on screen.
		EditorView.atomicRanges.of(
			(view) => view.state.field(foldField, false) ?? Decoration.none
		),
	];
}
