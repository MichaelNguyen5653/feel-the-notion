import { EditorSelection, Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import NotionBlock from "./main";
import { planBackspace, planSelectAll } from "./blockCommands";
import { detectIndentUnit } from "./dragRange";

/**
 * Cmd+A and Backspace, made block-aware.
 *
 * Prec.highest because both keys already have owners: CodeMirror's default
 * keymap binds them, and Obsidian binds Cmd+A as an app command. Returning
 * true from a CM6 command calls preventDefault, which Obsidian's scope
 * handling respects — but only if this runs first.
 *
 * Every command returns false wherever the existing behaviour is already
 * correct, so the editor's own handling stays in place by default rather than
 * being replaced wholesale.
 */
export const blockKeymapExtension = (plugin: NotionBlock): Extension =>
	Prec.highest(
		keymap.of([
			{
				key: "Mod-a",
				run: (view: EditorView) => {
					if (!isEnabled(plugin)) return false;
					const { state } = view;
					if (state.selection.ranges.length !== 1) return false;

					const plan = planSelectAll(state.doc, state.selection.main);
					if (!plan) return false;

					view.dispatch({
						selection: EditorSelection.single(plan.from, plan.to),
						userEvent: "select.block",
					});
					return true;
				},
			},
			{
				key: "Backspace",
				run: (view: EditorView) => {
					if (!isEnabled(plugin)) return false;
					const { state } = view;
					if (state.selection.ranges.length !== 1) return false;
					const range = state.selection.main;
					if (!range.empty) return false;

					const plan = planBackspace(state.doc, range.head, detectIndentUnit(state.doc));
					if (!plan) return false;

					// A plain dispatch, not dispatchBlockEdit: Backspace should
					// keep grouping with the typing around it, so undo walks back
					// through an edit at typing speed rather than one press per
					// character removed.
					view.dispatch({
						changes: plan.changes,
						selection: EditorSelection.cursor(plan.anchor),
						scrollIntoView: true,
						userEvent: "delete.backward",
					});
					return true;
				},
			},
		])
	);

function isEnabled(plugin: NotionBlock): boolean {
	return plugin.settings.enabled && plugin.settings.blockKeys;
}
