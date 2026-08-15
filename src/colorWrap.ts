/**
 * Wrapping a line's text in a colour span, and where the caret goes after.
 *
 * The caret position is the whole point. Colouring an empty block produced
 * `<span style="color: …"></span>` with nothing between the tags: Live Preview
 * renders inline HTML, an empty span renders as nothing, and the line vanished
 * — the colour had been applied to a block the user could no longer find.
 *
 * Landing the caret between the tags fixes both halves of that. Live Preview
 * shows the raw source of the line the caret is on, so the tags become visible
 * the moment the colour is applied, and whatever is typed next goes inside the
 * span and comes out in the chosen colour.
 *
 * Pure. See test/colorWrap.test.mjs.
 */

export interface ColorPlan {
	/** The line's replacement text. */
	text: string;
	/** Caret offset from the start of the line: the end of the content. */
	caretOffset: number;
}

export interface LineParts {
	prefix: string;
	content: string;
	suffix: string;
}

/** Splits a line into its markdown marker, its text, and a trailing block id. */
export function splitMarkdownLine(text: string): LineParts {
	const blockIdMatch = text.match(/(\s\^[A-Za-z0-9-]+)$/);
	const suffix = blockIdMatch?.[1] ?? "";
	const body = suffix ? text.slice(0, -suffix.length) : text;
	const prefixMatch = body.match(/^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s+)/);
	const prefix = prefixMatch?.[1] ?? "";
	return {
		prefix,
		content: body.slice(prefix.length).trim(),
		suffix
	};
}

/** Strips a colour wrapper this plugin applied earlier, if there is one. */
function unwrap(content: string): string {
	return content
		.replace(/^<span style="[^"]*">(.*)<\/span>$/u, "$1")
		.replace(/^<mark style="[^"]*">(.*)<\/mark>$/u, "$1");
}

/**
 * Plans the line rewrite for a colour choice.
 *
 * An empty tagName means the default colour: the wrapper comes off and nothing
 * replaces it.
 */
export function planColorWrap(lineText: string, tagName: string, style: string): ColorPlan {
	const parts = splitMarkdownLine(lineText);
	const content = unwrap(parts.content);

	if (!tagName) {
		return {
			text: `${parts.prefix}${content}${parts.suffix}`,
			caretOffset: parts.prefix.length + content.length,
		};
	}

	const openTag = `<${tagName} style="${style}">`;
	return {
		text: `${parts.prefix}${openTag}${content}</${tagName}>${parts.suffix}`,
		caretOffset: parts.prefix.length + openTag.length + content.length,
	};
}
