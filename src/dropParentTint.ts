import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { LineSpan } from "./dragRange";

/**
 * Tints the block a drop would nest under.
 *
 * In Notion the drop lines for every legal depth overlap into one bar, so the
 * faint tint on the would-be parent is what actually shows how deep a block
 * will land (docs/notion-drag-research.md §7). A line decoration rather than an
 * overlay: CodeMirror paints it with the line, so it can never drift from the
 * text it marks, and it maps through any edit that lands mid-drag.
 *
 * Set with `setDropParent.of(span)`, cleared with `setDropParent.of(null)`.
 * The drag sends one only when the parent actually changes, not every frame.
 */
export const setDropParent = StateEffect.define<LineSpan | null>();

const tint = Decoration.line({ class: "ftn-drop-parent" });

export const dropParentTintField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setDropParent)) continue;
			const span = effect.value;
			if (span === null) {
				deco = Decoration.none;
				continue;
			}
			const builder = new RangeSetBuilder<Decoration>();
			const last = Math.min(span.lastLine, tr.state.doc.lines);
			for (let n = span.firstLine; n <= last; n++) {
				const from = tr.state.doc.line(n).from;
				builder.add(from, from, tint);
			}
			deco = builder.finish();
		}
		return deco;
	},
	provide: (field) => EditorView.decorations.from(field),
});
