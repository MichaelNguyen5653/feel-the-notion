import { EditorState, Extension, Text } from "@codemirror/state";

/**
 * Bullet depth markers: the marker character in the FILE follows nesting depth.
 *
 *     - Framing
 *     	* Layout
 *     		+ Gridlines
 *     			- Column A      <- depth 4, the cycle repeats
 *
 * Ported from MichaelNguyen5653/Bullet-Depth-Markers, which shipped as its own
 * plugin. Changing the file rather than only the look is the point: CSS alone
 * leaves every bullet a `-`, so exports, grep and diffs never see the nesting.
 *
 * Everything above bulletDepthExtension is pure string-and-number logic, so
 * the whole core runs under node. See test/bulletDepth.test.mjs.
 */

export const DEFAULT_MARKERS: readonly string[] = ["-", "*", "+"];

/** The only characters CommonMark accepts as unordered list markers. */
const LEGAL_MARKERS: readonly string[] = ["-", "*", "+"];

/** Marker for a 1-based nesting depth, cycling through `markers`. */
export function markerForDepth(depth: number, markers: readonly string[]): string {
	return markers[(depth - 1) % markers.length];
}

// ── scanning ───────────────────────────────────────────────────────────────

interface Line {
	start: number;
	end: number;
	text: string;
}

type LineInfo =
	| { kind: "blank" | "other" }
	| { kind: "ul"; indent: string; markerOffset: number; marker: string }
	| { kind: "ol" | "cont"; indent: string };

export interface MarkerChange {
	from: number;
	to: number;
	insert: string;
}

const RE_BLANK = /^[ \t]*$/;
const RE_UL = /^([ \t]*)([-*+])([ \t]+|$)/;
const RE_OL = /^([ \t]*)(\d{1,9})([.)])([ \t]+|$)/;
// `---`, `***`, `___` and spaced forms like `- - -` are thematic breaks, not
// list items. Without this, `- - -` would parse as a bullet and get rewritten.
const RE_HR = /^[ \t]*((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const RE_FENCE = /^[ \t]*(`{3,}|~{3,})/;

function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	for (let i = 0; i <= text.length; i++) {
		if (i === text.length || text[i] === "\n") {
			lines.push({ start, end: i, text: text.slice(start, i) });
			start = i + 1;
		}
	}
	return lines;
}

/** Visual column of a leading-whitespace run, expanding tabs to tab stops. */
function indentColumn(ws: string, tabSize: number): number {
	let col = 0;
	for (const ch of ws) col = ch === "\t" ? col + tabSize - (col % tabSize) : col + 1;
	return col;
}

/**
 * Lines that must never be rewritten: YAML frontmatter and fenced code.
 *
 * Scanned from the top of the document rather than from the edit, because a
 * fence opened far above is invisible to a local scan, and bullets inside a
 * code block would otherwise be "corrected".
 */
function computeSkip(lines: Line[]): boolean[] {
	const skip = new Array<boolean>(lines.length).fill(false);
	let i = 0;

	if (lines.length && lines[0].text.trim() === "---") {
		let j = 1;
		while (j < lines.length && lines[j].text.trim() !== "---") j++;
		if (j < lines.length) {
			for (let k = 0; k <= j; k++) skip[k] = true;
			i = j + 1;
		}
	}

	let fenceChar: string | null = null;
	for (; i < lines.length; i++) {
		const m = RE_FENCE.exec(lines[i].text);
		if (fenceChar === null) {
			if (m) {
				fenceChar = m[1][0];
				skip[i] = true;
			}
		} else {
			skip[i] = true;
			if (m && m[1][0] === fenceChar) fenceChar = null;
		}
	}
	return skip;
}

function classify(rawText: string): LineInfo {
	// Files from disk and pasted text can carry \r. Left in place, a bare "\r"
	// line fails every pattern below and reads as a block-ending paragraph,
	// silently splitting loose lists.
	const text = rawText.endsWith("\r") ? rawText.slice(0, -1) : rawText;

	if (RE_BLANK.test(text)) return { kind: "blank" };
	if (RE_HR.test(text)) return { kind: "other" };

	const ul = RE_UL.exec(text);
	if (ul) return { kind: "ul", indent: ul[1], markerOffset: ul[1].length, marker: ul[2] };

	const ol = RE_OL.exec(text);
	if (ol) return { kind: "ol", indent: ol[1] };

	if (/^[ \t]/.test(text)) return { kind: "cont", indent: /^[ \t]*/.exec(text)?.[0] ?? "" };
	return { kind: "other" };
}

function lineIndexAt(lines: Line[], offset: number): number {
	let lo = 0;
	let hi = lines.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (offset > lines[mid].end) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

// ── planning ───────────────────────────────────────────────────────────────

/**
 * Assign depths across one contiguous list block and emit marker corrections.
 *
 * Depth comes from a stack of indent columns rather than whitespace divided by
 * a tab width, so a 2-space level inside a 4-space level, common in pasted
 * content, still gets stable depths.
 */
function emitBlock(
	lines: Line[],
	info: LineInfo[],
	from: number,
	to: number,
	tabSize: number,
	markers: readonly string[],
	out: MarkerChange[]
): void {
	const stack: number[] = [];
	for (let i = from; i <= to; i++) {
		const inf = info[i];
		if (inf.kind !== "ul" && inf.kind !== "ol") continue;

		const col = indentColumn(inf.indent, tabSize);
		while (stack.length && stack[stack.length - 1] >= col) stack.pop();
		stack.push(col);

		// Ordered items hold a level but keep their numbering.
		if (inf.kind !== "ul") continue;

		const want = markerForDepth(stack.length, markers);
		if (inf.marker !== want) {
			const pos = lines[i].start + inf.markerOffset;
			out.push({ from: pos, to: pos + 1, insert: want });
		}
	}
}

/**
 * The marker corrections needed for the list blocks touching [from, to].
 *
 * Every change swaps one character for one character, so the edit is
 * length-neutral and the caret cannot drift. Returns [] when everything
 * already matches, which is what stops the transaction filter recursing.
 */
export function planRewrites(
	text: string,
	from: number,
	to: number,
	tabSize: number,
	markers: readonly string[]
): MarkerChange[] {
	if (!markers.length) return [];

	const lines = splitLines(text);
	const skip = computeSkip(lines);
	const info: LineInfo[] = lines.map((l, i) => (skip[i] ? { kind: "other" } : classify(l.text)));

	// Grow the edited range out to whole list blocks, so depths are counted
	// from the real start of the list rather than from wherever the caret was.
	let start = lineIndexAt(lines, from);
	let end = lineIndexAt(lines, to);
	while (start > 0 && info[start - 1].kind !== "other") start--;
	while (end < lines.length - 1 && info[end + 1].kind !== "other") end++;

	const out: MarkerChange[] = [];
	let i = start;
	while (i <= end) {
		if (info[i].kind === "other") {
			i++;
			continue;
		}
		let j = i;
		while (j + 1 <= end && info[j + 1].kind !== "other") j++;
		emitBlock(lines, info, i, j, tabSize, markers, out);
		i = j + 1;
	}
	return out;
}

/** Apply planned changes to text. The tests use this; the editor applies its own. */
export function applyRewrites(text: string, changes: readonly MarkerChange[]): string {
	if (!changes.length) return text;
	const sorted = [...changes].sort((a, b) => a.from - b.from);
	let out = "";
	let pos = 0;
	for (const c of sorted) {
		out += text.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return out + text.slice(pos);
}

// ── settings ───────────────────────────────────────────────────────────────

/**
 * The marker sequence from the stored order and the markers switched off.
 *
 * Settings show all three legal markers as reorderable rows, each with a
 * toggle, the way the insert-menu list works. So the order is a permutation
 * of the three, and the sequence is whichever of them are on.
 *
 * Anything else in stored data is discarded. Only `-`, `*` and `+` are list
 * markers: writing any other character into a note stops the line parsing as
 * a list item at all, which corrupts the note rather than restyling it.
 */
export function resolveBulletMarkers(order: readonly string[], hidden: readonly string[]): string[] {
	const full: string[] = [];
	for (const marker of [...order, ...LEGAL_MARKERS]) {
		if (LEGAL_MARKERS.includes(marker) && !full.includes(marker)) full.push(marker);
	}

	const on = full.filter((marker) => !hidden.includes(marker));
	// Settings never let the last marker be switched off, but a hand-edited
	// data.json can. An empty sequence would turn the feature off silently
	// while its toggle still read as on.
	return on.length ? on : [full[0]];
}

// ── editor wiring ──────────────────────────────────────────────────────────

/** Whether any whole line overlapping [from, to] is a list item. */
function touchesList(doc: Text, from: number, to: number): boolean {
	const text = doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to);
	return text.split("\n").some((line) => {
		const kind = classify(line).kind;
		return kind === "ul" || kind === "ol";
	});
}

/**
 * Appends marker corrections to the transaction that caused them, rather than
 * dispatching a second one, so "indent and fix the marker" is one undo step.
 * That is also why it needs no hotkeys: Tab, a drag between depths, paste and
 * the slash menu all change indentation, and all get fixed the same way.
 *
 * `getMarkers` returns null while the feature is off, and is read per
 * transaction so the toggle takes effect without reloading the editor.
 *
 * Re-entry is safe: an already-correct document plans no changes, so a second
 * pass over this filter's own output is a no-op.
 */
export function bulletDepthExtension(getMarkers: () => readonly string[] | null): Extension {
	return EditorState.transactionFilter.of((tr) => {
		if (!tr.docChanged) return tr;

		const markers = getMarkers();
		if (!markers) return tr;

		// Opening a note fills an empty editor in one transaction covering the
		// whole document. Treating that as an edit would rewrite every marker
		// in the file on open and mark it dirty. Existing notes are only ever
		// reconciled where they are actually edited.
		if (tr.startState.doc.length === 0) return tr;

		let fromA = Infinity;
		let toA = -1;
		let from = Infinity;
		let to = -1;
		tr.changes.iterChangedRanges((startA, endA, startB, endB) => {
			fromA = Math.min(fromA, startA);
			toA = Math.max(toA, endA);
			from = Math.min(from, startB);
			to = Math.max(to, endB);
		});
		if (to < 0) return tr;

		// Only an edit that touches a list item, before or after, can move any
		// marker's depth. planRewrites grows an edit outward through blank
		// lines, so without this, typing in a paragraph next to an old list
		// rewrote the list — breaking the standalone plugin's own promise that
		// a list is only fixed where it is edited. Checking the old side too is
		// what keeps "turn a parent into a paragraph" re-levelling its children.
		if (!touchesList(tr.startState.doc, fromA, toA) && !touchesList(tr.newDoc, from, to)) return tr;

		// chisle: whole-document scan per edit, as the standalone plugin did.
		// Fences are found from the top, so a local scan cannot be trusted.
		// Only runs with the feature on; narrow it if long notes start to lag.
		const changes = planRewrites(
			tr.newDoc.toString(),
			from,
			to,
			tr.startState.tabSize || 4,
			markers
		);
		return changes.length ? [tr, { changes, sequential: true }] : tr;
	});
}
