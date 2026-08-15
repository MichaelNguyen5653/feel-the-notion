import { EditorView } from "@codemirror/view";
import { TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";

/**
 * Block-level undo.
 *
 * Goal: one block operation = exactly one undo step. Neither more nor less.
 *
 * WHAT WAS ACTUALLY BROKEN
 * Operations built from two dispatches became two undo steps. Inserting a
 * footnote dispatched the definition and the reference separately, so it took
 * two Cmd+Z presses to undo one action — and in between, the document held a
 * reference pointing at no definition. Fixed by merging into one transaction.
 *
 * WHAT WAS NOT BROKEN
 * The original plan assumed block ops were also merging with adjacent typing,
 * and that isolateHistory was needed to stop it. Measured against real
 * CodeMirror, that is false: history groups by userEvent, so "move.block" is
 * already separated from "input.type". See the two baseline tests in
 * test/history.test.mjs, which record the real behaviour.
 *
 * WHY THE ANNOTATION STAYS
 * It is free, and it pins the guarantee rather than relying on every future
 * block op remembering to pick a non-input userEvent. An op tagged
 * "input.something", or left untagged, WOULD merge with typing.
 *
 * WHEN ADDING A NEW BLOCK OPERATION
 * 1. Build the whole thing as ONE TransactionSpec — every `changes` entry in
 *    one array, not several dispatches in sequence.
 * 2. Send it through `dispatchBlockEdit` rather than `view.dispatch`.
 * There is a regression test covering both halves in test/history.test.mjs.
 */
export function dispatchBlockEdit(view: EditorView, spec: TransactionSpec): void {
	view.dispatch({
		...spec,
		annotations: [
			isolateHistory.of("full"),
			...toArray(spec.annotations),
		],
	});
}

// TransactionSpec.annotations accepts a single annotation or an array; both
// have to survive being merged with the isolation annotation above.
function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value as T];
}
