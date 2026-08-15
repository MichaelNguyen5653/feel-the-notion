/**
 * How a saved attachment is written into the document.
 *
 * Obsidian's generateMarkdownLink follows the vault's link-format setting, so
 * it returns a wikilink in most vaults. The requirement here is a markdown
 * link — `[name](path)` — with the leading `!` under a setting, because an
 * embed and a link read very differently in a page of notes.
 *
 * Pure. See test/attachmentLink.test.mjs.
 */

/**
 * Percent-encodes a vault path for a markdown link target.
 *
 * Parentheses are escaped beyond what encodeURI does: an unescaped `)` inside
 * `[x](...)` closes the link early, so a file named `report (final).pdf` would
 * produce a broken link and stray text.
 */
export function encodeLinkPath(path: string): string {
	return encodeURI(path).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** The file name without its directory or extension. */
export function linkDisplayName(path: string): string {
	const name = path.split("/").pop() ?? path;
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Converts whatever Obsidian generated into a markdown link.
 *
 * Wikilinks are rewritten; a markdown link is passed through with its `!`
 * normalised, so the embed setting is the only thing that decides it.
 */
export function toMarkdownLink(generated: string, path: string, embed: boolean): string {
	const source = generated.trim();
	const wiki = /^!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(source);

	let link: string;
	if (wiki) {
		const target = wiki[1];
		const alias = wiki[2]?.trim() || linkDisplayName(target);
		link = `[${alias}](${encodeLinkPath(target)})`;
	} else {
		link = source.replace(/^!/, "");
		// An empty label is legal markdown but unreadable in the source, and it
		// is what Obsidian emits for attachments. Fill it with the file name.
		link = link.replace(/^\[\]\(/, `[${linkDisplayName(path)}](`);
	}

	return (embed ? "!" : "") + link;
}
