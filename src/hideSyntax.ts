import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { findMarkerRanges } from "./markerRanges";
import type NotionBlock from "./main";

/**
 * Removes the horizontal jitter when the caret enters a formatted span.
 *
 * THE PROBLEM
 * Live Preview strips `**` from inactive lines and puts it back on the active
 * one. Putting it back costs layout width, so every character after it slides
 * sideways as the caret arrives, and slides back as it leaves. Notion never
 * reflows, because it has no syntax to reveal — that constant twitch is the
 * strongest signal that you are in a text editor rather than a document.
 *
 * THE APPROACH
 * Hide the markers on the active line too. Inactive lines already render zero
 * width; making the active line match means both states are identical and
 * there is nothing left to reflow.
 *
 * WHY atomicRanges MATTERS
 * Replacing a range hides it but leaves the document positions behind it.
 * Without atomicRanges the caret still visits those positions, so arrowing
 * through `**bold**` appears to stall for two presses at each end with no
 * visible movement. Registering the same ranges as atomic makes CodeMirror
 * step over each marker as a single unit, so Left/Right move by visible
 * characters — which is what the user is actually looking at.
 *
 * THE TRADE
 * Markers become invisible even while editing, so `**` cannot be clicked
 * between or hand-edited. That is Notion's model — you apply bold with Cmd+B
 * rather than by typing asterisks — but it is a real change in behaviour, so
 * it ships behind a setting and defaults to OFF.
 */

const hiddenMarker = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			for (const range of findMarkerRanges(line.text, line.from)) {
				builder.add(range.from, range.to, hiddenMarker);
			}
			if (line.to + 1 > to) break;
			pos = line.to + 1;
		}
	}

	return builder.finish();
}

export function hideSyntaxExtension(plugin: NotionBlock) {
	const plugins = [
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = plugin.settings.hideSyntaxMarkers
						? buildDecorations(view)
						: Decoration.none;
				}

				update(update: ViewUpdate) {
					if (!plugin.settings.hideSyntaxMarkers) {
						this.decorations = Decoration.none;
						return;
					}
					// Selection changes matter as well as edits: Obsidian adds
					// and removes its own marker decorations as the caret moves
					// between lines, so ours have to be rebuilt in step.
					if (update.docChanged || update.viewportChanged || update.selectionSet) {
						this.decorations = buildDecorations(update.view);
					}
				}
			},
			{ decorations: (value) => value.decorations }
		),

		// Same ranges again, as atomic. Kept as a separate facet provider
		// rather than derived from the plugin above so that if the decoration
		// plugin is ever rebuilt mid-update, the caret cannot briefly land
		// inside a hidden marker.
		EditorView.atomicRanges.of((view) =>
			plugin.settings.hideSyntaxMarkers ? buildDecorations(view) : Decoration.none
		),
	];

	return plugins;
}
