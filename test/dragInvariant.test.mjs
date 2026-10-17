/**
 * The drag's headline guarantee, checked over every move a user could make.
 *
 * Notion never lets a drop re-parent anything it was not aimed at
 * (docs/notion-drag-research.md §3). In list terms: after ANY legal drop,
 *   (a) every line that did not move keeps the parent it had, and
 *   (b) the moved block's parent is the one the drop tint named.
 *
 * Example-based tests pin cases someone thought of. This enumerates every
 * source block x every target line x every offered indent over a few
 * well-formed documents, so a depth rule that is wrong somewhere nobody
 * looked fails here.
 *
 * Two shapes are deliberately outside the guarantee and kept out of the
 * fixtures: flat prose directly above an indented line (allowedIndents offers
 * no choice after prose, by design), and an indented first line (nothing
 * above it to be a child of).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { resolveDragRange, allowedIndents, findDropParent, detectIndentUnit, indentWidth, isBlank, isListItem } from "./.build/dragRange.js";
import { planBlockMove, applyChanges, isNoOpMove } from "./.build/planMove.js";

const FIXTURES = {
	"nested bullets, prose, heading, blanks": [
		"# Title",
		"",
		"- a",
		"    - a1",
		"        - a1x",
		"    - a2",
		"- b",
		"",
		"para one",
		"para two",
		"",
		"- c",
		"    - c1",
		"- d",
	],
	"two-space unit": ["- a", "  - b", "    - c", "  - d", "- e", "  - f"],
	"numbered, tasks, continuation lines": [
		"1. one",
		"    - x",
		"2. two",
		"",
		"## H",
		"- [ ] t1",
		"    - [ ] t2",
		"- item",
		"    continuation",
		"    - sub",
		"text after",
	],
};

/** The nearest non-blank line above with a smaller indent, by trimmed text. */
function parentsOf(lines) {
	const parents = new Map();
	lines.forEach((text, i) => {
		if (isBlank(text)) return;
		let parent = null;
		for (let n = i - 1; n >= 0; n--) {
			if (isBlank(lines[n])) continue;
			if (indentWidth(lines[n]) < indentWidth(text)) {
				parent = lines[n].trim();
				break;
			}
		}
		const key = text.trim();
		assert.ok(!parents.has(key), `fixture lines must be unique: ${key}`);
		parents.set(key, parent);
	});
	return parents;
}

/** The two shapes the guarantee does not cover; fixtures must avoid them. */
function hasExcludedShape(lines) {
	const content = lines.filter((l) => !isBlank(l));
	if (content.length > 0 && indentWidth(content[0]) > 0) return true;
	return content.some(
		(l, i) => i > 0 && !isListItem(content[i - 1]) && indentWidth(content[i - 1]) === 0 && indentWidth(l) > 0
	);
}

for (const [name, lines] of Object.entries(FIXTURES)) {
	test(`no drop re-parents an unmoved line: ${name}`, () => {
		assert.equal(hasExcludedShape(lines), false, "fixture must stay inside the guarantee");

		const text = lines.join("\n");
		const doc = EditorState.create({ doc: text }).doc;
		const unit = detectIndentUnit(doc);
		const before = parentsOf(lines);

		const seen = new Set();
		let checked = 0;

		for (let n = 1; n <= doc.lines; n++) {
			if (isBlank(doc.line(n).text)) continue;
			const range = resolveDragRange(doc, n, "paragraph");
			if (seen.has(range.firstLine)) continue;
			seen.add(range.firstLine);

			const source = {
				from: range.from,
				to: range.to,
				text: doc.sliceString(range.from, range.to),
				indent: range.indent,
				firstLine: range.firstLine,
				lastLine: range.lastLine,
			};
			const skip = { firstLine: range.firstLine, lastLine: range.lastLine };
			const movedKeys = new Set(
				source.text.split("\n").filter((l) => !isBlank(l)).map((l) => l.trim())
			);
			const firstKey = doc.line(range.firstLine).text.trim();

			for (let target = 1; target <= doc.lines + 1; target++) {
				for (const indent of allowedIndents(doc, target, unit, skip)) {
					if (isNoOpMove(source, target, indent)) continue;

					const changes = planBlockMove(doc, source, target, indent);
					const after = parentsOf(applyChanges(text, changes).split("\n"));
					const where = `"${firstKey}" to line ${target} at indent ${indent}`;

					for (const [key, parent] of before) {
						if (movedKeys.has(key)) continue;
						assert.equal(after.get(key), parent, `${where} re-parented "${key}"`);
					}

					const named = findDropParent(doc, target, indent, skip);
					assert.equal(
						after.get(firstKey),
						named ? doc.line(named.firstLine).text.trim() : null,
						`${where}: the tinted parent is not the real one`
					);
					checked++;
				}
			}
		}

		assert.ok(checked > 50, "the enumeration must actually cover moves");
	});
}
