import { dispatchBlockEdit } from "./history";
import { EditorView } from "@codemirror/view";
import { moment, Notice } from "obsidian";
import NotionBlock from "./main";
import { t } from "./locale/helpers";
import { InsertChange, planInsert } from "./insertPlan";
import { toMarkdownLink } from "./attachmentLink";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

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
    return name.replace(/[\\/\r\n\t]/g, "-").trim() || "image.png";
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
            case "today": insertText = moment().format(settings.dateFormat); break;
            case "yesterday": insertText = moment().subtract(1, 'days').format(settings.dateFormat); break;
            case "tomorrow": insertText = moment().add(1, 'days').format(settings.dateFormat); break;
            case "time": insertText = moment().format(settings.timeFormat); break;
            case "table": {
                const col1 = `${t("table.column")} 1`;
                const col2 = `${t("table.column")} 2`;
                const col3 = `${t("table.column")} 3`;
                insertText = `| ${col1} | ${col2} | ${col3} |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`;
                cursorOffset = 7 + col1.length + col2.length;
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

    const plan = planInsert({
        lineFrom: line.from,
        lineTo: line.to,
        lineText: line.text,
        insertText,
        cursorOffset: cursorOffset || insertText.length,
        asBlock: isNewLine,
        at: customPos ?? undefined,
        remove,
        extra: extraChanges,
    });

    dispatchBlockEdit(view, {
        changes: plan.changes,
        selection: { anchor: plan.anchor },
        scrollIntoView: true,
        userEvent: "insert.block"
    });
}
