import { dispatchBlockEdit } from "./history";
import { EditorView } from "@codemirror/view";
import { moment, Notice } from "obsidian";
import NotionBlock from "./main";
import { t } from "./locale/helpers";
import { InsertChange, indentInsert, planInsert } from "./insertPlan";
import { indentString } from "./dragRange";
import { toMarkdownLink } from "./attachmentLink";
import { collectHeadings, prefixLines, quotePrefix, tableOfContents } from "./tableOfContents";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

/**
 * The slice of moment's API this file uses.
 *
 * Obsidian re-exports moment without types the linter can follow, so every
 * call read as `any` and the format strings went unchecked. Naming the three
 * methods used here restores that without pulling in a types package.
 */
interface MomentLike {
    format(pattern: string): string;
    add(amount: number, unit: string): MomentLike;
    subtract(amount: number, unit: string): MomentLike;
}

const now = (): MomentLike => moment() as unknown as MomentLike;

/** Text to delete as part of an insert — the `/query` that opened the menu. */
export interface RemoveRange {
    from: number;
    to: number;
}

export function detectBlockType(lineText: string): string {
    if (/^#{1,6} /.test(lineText)) return "heading";
    if (/^[-*+] \[[ x]\] /.test(lineText)) return "todo";
    if (/^[-*+] /.test(lineText)) return "bullet";
    if (/^\d+\. /.test(lineText)) return "numbered";
    if (/^> \[!/.test(lineText)) return "callout";
    if (/^> /.test(lineText)) return "blockquote";
    if (/^%%/.test(lineText)) return "comment";
    return "paragraph";
}

export function stripPrefix(lineText: string): string {
    return lineText
        .replace(/^#{1,6} /, "")
        .replace(/^[-*+] \[[ x]\] /, "")
        .replace(/^[-*+] /, "")
        .replace(/^\d+\. /, "")
        .replace(/^> \[![^\]]+\][+-]?\n?> ?/, "")
        .replace(/^> /, "")
        .replace(/^%%(.*)%%$/, "$1")
        .trim();
}

export async function insertImageFiles(
    plugin: NotionBlock,
    view: EditorView,
    lineNo: number,
    files: File[],
    remove?: RemoveRange
): Promise<void> {
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) {
        new Notice(t("notice.selectImage"));
        return;
    }

    try {
        const links = await saveAttachments(plugin, imageFiles, (link) => `!${link}`);
        insertTextAtLineEnd(view, lineNo, links.join("\n"), true, remove);
    } catch {
        new Notice(t("notice.insertImageFailed"));
    }
}

/**
 * Saves arbitrary files into the vault's attachment folder and links them.
 *
 * Files of any type, unlike insertImageFiles — this is the "insert attachment"
 * entry. The destination comes from getAvailablePathForAttachment, so it
 * follows whatever the core Files & Links setting says rather than second-
 * guessing it. The link is a markdown link, embedded only when the setting
 * asks for it.
 */
export async function insertAttachmentFiles(
    plugin: NotionBlock,
    view: EditorView,
    lineNo: number,
    files: File[],
    remove?: RemoveRange
): Promise<void> {
    if (files.length === 0) return;

    try {
        const embed = plugin.settings.embedAttachments;
        const links = await saveAttachments(plugin, files, (link, path) =>
            toMarkdownLink(link, path, embed)
        );
        insertTextAtLineEnd(view, lineNo, links.join("\n"), true, remove);
    } catch {
        new Notice(t("notice.insertAttachmentFailed"));
    }
}

/**
 * Creates a note beside the current one and links to it, Notion's /page.
 *
 * "Beside" is literal: the new note lands in the same folder as the note the
 * command was run from, not in a subfolder, because Obsidian has no notion of
 * a page owning another page — the link is the only relationship there is.
 *
 * The link goes in first and the new note is opened second. Reversing that
 * would dispatch the insert into an editor that had already been swapped out
 * from under it.
 *
 * The name is "Untitled" because there is nowhere to ask for one without a
 * modal, and Obsidian rewrites the link automatically when the note is renamed
 * from its title — which is the first thing anyone does.
 */
export async function insertNewPage(
    plugin: NotionBlock,
    view: EditorView,
    lineNo: number,
    remove?: RemoveRange
): Promise<void> {
    const active = plugin.app.workspace.getActiveFile();
    const sourcePath = active?.path ?? "";
    const folder = active?.parent?.path ?? "";

    try {
        const file = await plugin.app.vault.create(
            availableNotePath(plugin, folder, t("page.untitled")),
            ""
        );
        // generateMarkdownLink rather than a hand-built "[[name]]": it follows
        // the vault's own link style and disambiguates a basename that already
        // exists in another folder, which a bare wikilink would resolve to.
        insertTextAtLineEnd(view, lineNo, plugin.app.fileManager.generateMarkdownLink(file, sourcePath), false, remove);
        await plugin.app.workspace.getLeaf(false).openFile(file);
    } catch {
        new Notice(t("notice.createPageFailed"));
    }
}

/** First "Untitled", "Untitled 1", ... that no note is already using. */
function availableNotePath(plugin: NotionBlock, folder: string, base: string): string {
    // The vault root's path is "/", not "", so joining naively produces
    // "//Untitled.md" for every note that is not inside a folder.
    const prefix = folder && folder !== "/" ? `${folder}/` : "";
    for (let n = 0; n < 1000; n++) {
        const path = `${prefix}${n === 0 ? base : `${base} ${n}`}.md`;
        if (!plugin.app.vault.getAbstractFileByPath(path)) return path;
    }
    throw new Error("no available note name");
}

/**
 * Inserts a snapshot of the note's headings as a titled, nested list of links.
 *
 * Callout-aware. A callout is a blockquote, so every line of a multi-line
 * insert needs its `>` repeating — without that the first row stayed inside
 * the `> [!info]` block and the rest fell out the bottom as loose text.
 *
 * With no headings the query is still deleted and a notice explains why
 * nothing appeared — leaving "/table of contents" sitting in the note reads as
 * the command having silently failed.
 */
export function insertTableOfContents(
    view: EditorView,
    lineNo: number,
    remove?: RemoveRange
): void {
    const line = view.state.doc.line(lineNo);
    const body = tableOfContents(collectHeadings(view.state.doc, lineNo), {
        title: t("toc.title"),
    });

    if (body.length === 0) {
        insertTextAtLineEnd(view, lineNo, "", false, remove);
        new Notice(t("notice.noHeadings"));
        return;
    }

    // What is left on this line once the query goes. A line holding nothing but
    // its callout marker is an empty block, so the list belongs on it rather
    // than on a new line below it.
    const remaining = remove
        ? line.text.slice(0, remove.from - line.from) + line.text.slice(remove.to - line.from)
        : line.text;
    const prefix = quotePrefix(line.text);
    const onNewLine = remaining.slice(prefix.length).trim().length > 0;

    // Staying on this line means the caret already sits after the marker, so
    // the first row must not repeat it.
    insertTextAtLineEnd(view, lineNo, prefixLines(body, prefix, !onNewLine), onNewLine, remove);
}

async function saveAttachments(
    plugin: NotionBlock,
    files: File[],
    format: (generatedLink: string, path: string) => string
): Promise<string[]> {
    const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
    const links: string[] = [];

    for (const file of files) {
        const safeName = sanitizeAttachmentName(file.name);
        const targetPath = await plugin.app.fileManager.getAvailablePathForAttachment(safeName, sourcePath);
        const savedFile = await plugin.app.vault.createBinary(targetPath, await file.arrayBuffer());
        const generated = plugin.app.fileManager.generateMarkdownLink(savedFile, sourcePath);
        links.push(format(generated, savedFile.path));
    }

    return links;
}

function insertTextAtLineEnd(
    view: EditorView,
    lineNo: number,
    insertText: string,
    insertAsBlock: boolean,
    remove?: RemoveRange
): void {
    const line = view.state.doc.line(lineNo);
    const plan = planInsert({
        lineFrom: line.from,
        lineTo: line.to,
        lineText: line.text,
        insertText,
        asBlock: insertAsBlock,
        remove,
    });

    dispatchBlockEdit(view, {
        changes: plan.changes,
        selection: { anchor: plan.anchor },
        scrollIntoView: true,
        userEvent: "insert.block"
    });

}

function isImageFile(file: File): boolean {
    const ext = getFileExtension(file.name);
    return IMAGE_EXTENSIONS.has(ext);
}

function sanitizeAttachmentName(name: string): string {
    // The name comes from the OS file picker, so it is the user's own and a
    // browser hands over the basename only. Hardened anyway, because this
    // string becomes a path: separators, characters Windows rejects, and
    // control characters are replaced, and leading dots are dropped so nothing
    // can resolve to "." or "..".
    const cleaned = name
        .replace(/[\\/:*?"<>|]/g, "-")
        // eslint-disable-next-line no-control-regex -- matching control
        // characters is the entire point here: they are what has to come out
        // of a name that is about to become a file path.
        .replace(/[\u0000-\u001f\u007f]/g, "-")
        .replace(/^\.+/, "")
        .trim();
    return cleaned || "attachment";
}

function getFileExtension(name: string): string {
    const index = name.lastIndexOf(".");
    if (index < 0) return "";
    return name.slice(index + 1).toLowerCase();
}

export function transformLine(view: EditorView, lineNo: number, targetType: string) {
    const line = view.state.doc.line(lineNo);
    const lineText = line.text;
    const content = stripPrefix(lineText);
    
    let newText = "";
    
    if (targetType.startsWith("callout-")) {
        const type = targetType.replace("callout-", "");
        newText = `> [!${type}]\n> ${content}`;
    } else {
        switch (targetType) {
            case "h1": newText = "# " + content; break;
            case "h2": newText = "## " + content; break;
            case "h3": newText = "### " + content; break;
            case "h4": newText = "#### " + content; break;
            case "h5": newText = "##### " + content; break;
            case "bullet": 
            case "toggle": newText = "- " + content; break;
            case "numbered": newText = "1. " + content; break;
            case "todo": newText = "- [ ] " + content; break;
            case "blockquote": newText = "> " + content; break;
            case "paragraph": newText = content; break;
            case "code": newText = "```\n" + content + "\n```"; break;
            case "math": newText = "$$\n" + content + "\n$$"; break;
            case "divider": newText = "---"; break;
            default: newText = content; break;
        }
    }
    
    dispatchBlockEdit(view, {
        changes: {
            from: line.from,
            to: line.to,
            insert: newText
        },
        userEvent: "input.block-transform"
    });
}

export function insertBlock(
    plugin: NotionBlock,
    view: EditorView,
    lineNo: number,
    targetType: string,
    remove?: RemoveRange
) {
    const line = view.state.doc.line(lineNo);
    const settings = plugin.settings;

    let insertText = "";
    let cursorOffset = 0;
    let isMetadata = false;
    let customPos: number | null = null;
    // Changes that belong to this insert but land outside the cursor position
    // (currently only the footnote definition appended at the end of the
    // document). Merged into the single dispatch below so the whole insert
    // stays one undo step.
    const extraChanges: InsertChange[] = [];

    if (targetType.startsWith("callout-")) {
        const type = targetType.replace("callout-", "");
        insertText = `> [!${type}]\n> `;
        cursorOffset = insertText.length;
    } else {
        switch (targetType) {
            case "h1": insertText = "# "; break;
            case "h2": insertText = "## "; break;
            case "h3": insertText = "### "; break;
            case "h4": insertText = "#### "; break;
            case "h5": insertText = "##### "; break;
            case "todo": insertText = "- [ ] "; break;
            case "toggle":
            case "bullet": insertText = "- "; break;
            case "numbered": insertText = "1. "; break;
            case "blockquote": insertText = "> "; break;
            case "paragraph": insertText = ""; break;
            case "code": insertText = "```\n\n```"; cursorOffset = 4; break;
            case "math": insertText = "$$\n\n$$"; cursorOffset = 3; break;
            case "divider": insertText = "---\n"; break;
            
            // Advanced types
            case "link": insertText = "[[]]"; cursorOffset = 2; break;
            case "ext-link": insertText = "[]()"; cursorOffset = 1; break;
            case "embed": insertText = "![[]]"; cursorOffset = 3; break;
            case "tag": insertText = "#"; cursorOffset = 1; break;
            case "comment": insertText = "%%  %%"; cursorOffset = 3; break;
            case "today": insertText = now().format(settings.dateFormat); break;
            case "yesterday": insertText = now().subtract(1, 'days').format(settings.dateFormat); break;
            case "tomorrow": insertText = now().add(1, 'days').format(settings.dateFormat); break;
            case "time": insertText = now().format(settings.timeFormat); break;
            case "table": {
                // Empty, not pre-filled with "Column 1/2/3". Placeholder text
                // has to be selected and deleted three times before the table
                // is usable, and it is the first thing anyone types over.
                insertText = "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";
                // Inside the first header cell.
                cursorOffset = 2;
                break;
            }
            case "frontmatter": {
                isMetadata = true;
                const firstLine = view.state.doc.line(1);
                if (firstLine.text === "---") {
                    // Already exists
                    return;
                }
                insertText = "---\n\n---\n";
                customPos = 0;
                cursorOffset = 4;
                break;
            }
            case "footnote": {
                const footnoteId = Math.floor(Math.random() * 1000);
                insertText = `[^${footnoteId}]`;
                // Queued rather than dispatched here on purpose. Dispatching
                // separately made one footnote insert cost two Cmd+Z presses,
                // with the document briefly holding a reference that pointed
                // at no definition. Merged into the single dispatch below.
                extraChanges.push({
                    from: view.state.doc.length,
                    insert: `\n\n[^${footnoteId}]: `,
                });
                break;
            }
            default: insertText = ""; break;
        }
    }

    const isNewLine = !isMetadata && !["link", "ext-link", "embed", "tag", "comment", "today", "yesterday", "tomorrow", "time"].includes(targetType);

    // Tables render as literal text without a blank line above them. The line
    // above the insertion point decides whether that blank line already
    // exists; planInsert only ever sees the current line, so the check has to
    // happen here, where the full document is available.
    const needsBlankLine = targetType === "table";
    const previousLineHasContent = needsBlankLine && lineNo > 1 && view.state.doc.line(lineNo - 1).text.trim().length > 0;

    // Only the first line of a multi-line insert inherits the indentation
    // already on the line; everything after a newline starts at column zero.
    // Tabbing to indent and then typing /code opened a fence at the caret's
    // indent and closed it at the margin, which is not a code block. Same for
    // /math, /table and callouts.
    //
    // Skipped for the two inserts that do not land on this line at all:
    // frontmatter goes to the top of the file, and a footnote's definition to
    // the end of it.
    let caretOffset = cursorOffset || insertText.length;
    if (!isMetadata && customPos === null) {
        const indented = indentInsert(insertText, indentString(line.text), caretOffset);
        insertText = indented.text;
        caretOffset = indented.cursorOffset;
    }

    const plan = planInsert({
        lineFrom: line.from,
        lineTo: line.to,
        lineText: line.text,
        insertText,
        cursorOffset: caretOffset,
        asBlock: isNewLine,
        at: customPos ?? undefined,
        remove,
        extra: extraChanges,
        needsBlankLine,
        previousLineHasContent,
    });

    dispatchBlockEdit(view, {
        changes: plan.changes,
        selection: { anchor: plan.anchor },
        scrollIntoView: true,
        userEvent: "insert.block"
    });

    // The caret lands in the first cell arithmetically — planInsert is tested
    // on exactly that — and then Obsidian moves it. A table becomes a rendered
    // widget, and the decision about where the caret goes is made while the
    // widget is being built, from a document state where the table does not
    // exist yet: it ends up past the whole thing instead of inside it.
    //
    // Re-asserting the same position once the widget exists is what sticks.
    // Selection-only, so it costs no extra undo step, and it is skipped if the
    // document moved underneath in the meantime.
    if (targetType === "table") {
        const win = view.dom.ownerDocument.defaultView ?? activeWindow;
        win.requestAnimationFrame(() => {
            if (plan.anchor > view.state.doc.length) return;
            view.dispatch({ selection: { anchor: plan.anchor }, scrollIntoView: true });
        });
    }
}
