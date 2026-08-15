import { dispatchBlockEdit } from "./history";
import { EditorView } from "@codemirror/view";
import NotionBlock from "./main";
import {
    resolveDragRange,
    reindentBlock,
    allowedIndents,
    pickIndent,
    detectIndentUnit,
} from "./dragRange";

export class DragManager {
    private ghostEl: HTMLElement | null = null;
    private indicatorEl: HTMLElement | null = null;
    private isDragging = false;
    private startBlock: { from: number, to: number, text: string, indent: number } | null = null;
    private currentTargetLine: number | null = null;
    /** Indent the block will adopt on drop, chosen by horizontal drag position. */
    private currentTargetIndent = 0;
    /** Indent levels legal at the current drop point. One entry = no choice. */
    private currentAllowedIndents: number[] = [0];
    private indentUnit = 4;
    private ownerDocument: Document;
    private ownerWindow: Window;
    private onDragEnd?: () => void;

    constructor(private plugin: NotionBlock, private view: EditorView) {
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = this.ownerDocument.defaultView ?? activeWindow;
    }

    startDrag(lineNo: number, event: MouseEvent, onDragEnd?: () => void) {
        this.onDragEnd = onDragEnd;
        this.isDragging = true;

        const doc = this.view.state.doc;

        // Resolve the range BEFORE clearing the selection below. Dragging from
        // inside a multi-block selection has to carry every selected block,
        // and clearing first would throw away the only record of which those
        // were — the bug this ordering exists to prevent.
        const range = resolveDragRange(
            doc,
            lineNo,
            this.plugin.settings.dragGranularity,
            this.view.state.selection
        );

        // Clear any existing selection
        this.ownerWindow.getSelection()?.removeAllRanges();

        const fromPos = range.from;
        const toPos = range.to;
        const text = doc.sliceString(fromPos, toPos);

        this.startBlock = { from: fromPos, to: toPos, text: text, indent: range.indent };
        this.indentUnit = detectIndentUnit(doc);

        // Create ghost element
        this.ghostEl = this.ownerDocument.body.createDiv({
            cls: "block-drag-ghost",
            text: text.slice(0, 50) + (text.length > 50 ? "..." : "")
        });
        this.updateGhostPosition(event.clientX, event.clientY);

        // Create indicator line
        this.indicatorEl = this.ownerDocument.body.createDiv({
            cls: "block-drag-indicator"
        });

        this.ownerDocument.addEventListener("mousemove", this.onMouseMove);
        this.ownerDocument.addEventListener("mouseup", this.onMouseUp);
        
        // Prevent text selection during drag
        this.ownerDocument.body.addClass("is-dragging-block");
    }

    private onMouseMove = (event: MouseEvent) => {
        if (!this.isDragging) return;

        this.updateGhostPosition(event.clientX, event.clientY);

        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos !== null) {
            const line = this.view.state.doc.lineAt(pos);
            this.updateIndicator(line.number, event.clientY, event.clientX);
        }
    };

    private onMouseUp = (_event: MouseEvent) => {
        this.stopDrag();
    };

    private stopDrag() {
        if (!this.isDragging) return;

        if (this.startBlock !== null && this.currentTargetLine !== null) {
            this.moveBlock(this.startBlock, this.currentTargetLine);
        }

        this.isDragging = false;
        this.startBlock = null;
        this.currentTargetLine = null;

        if (this.ghostEl) {
            this.ghostEl.remove();
            this.ghostEl = null;
        }
        if (this.indicatorEl) {
            this.indicatorEl.remove();
            this.indicatorEl = null;
        }

        this.ownerDocument.removeEventListener("mousemove", this.onMouseMove);
        this.ownerDocument.removeEventListener("mouseup", this.onMouseUp);
        this.ownerDocument.body.removeClass("is-dragging-block");

        // Let the handle drop its cached line number — the drag has rewritten
        // the document, so that number no longer means what it did.
        this.onDragEnd?.();
    }

    private updateGhostPosition(x: number, y: number) {
        if (this.ghostEl) {
            this.ghostEl.setCssStyles({
                left: `${x + 10}px`,
                top: `${y + 10}px`
            });
        }
    }

    private updateIndicator(lineNo: number, mouseY: number, mouseX: number) {
        if (!this.indicatorEl) return;

        try {
            const line = this.view.state.doc.line(lineNo);
            const coords = this.view.coordsAtPos(line.from);
            
            if (coords) {
                // Use coordsAtPos for the end of line to determine full line height
                const endCoords = this.view.coordsAtPos(line.to);
                
                let top = coords.top;
                let targetLine = lineNo;

                if (endCoords) {
                    const lineBottom = endCoords.bottom;
                    const midPoint = coords.top + (lineBottom - coords.top) / 2;
                    if (mouseY > midPoint) {
                        top = lineBottom;
                        targetLine = lineNo + 1;
                    } else {
                        top = coords.top;
                        targetLine = lineNo;
                    }
                }

                this.currentTargetLine = targetLine;

                // Horizontal drag position chooses the drop depth, snapped to
                // the levels that are actually legal here. Where only one is
                // legal there is nothing to choose and the indicator sits flush,
                // which is the behaviour in a document with no lists.
                const contentRect = this.view.contentDOM.getBoundingClientRect();
                const columnPx = this.view.defaultCharacterWidth || 8;
                this.currentAllowedIndents = allowedIndents(
                    this.view.state.doc,
                    targetLine,
                    this.indentUnit
                );
                const desired = Math.max(0, Math.round((mouseX - contentRect.left) / columnPx));
                this.currentTargetIndent = pickIndent(this.currentAllowedIndents, desired);

                const offsetPx = this.currentTargetIndent * columnPx;
                const hasChoice = this.currentAllowedIndents.length > 1;
                this.indicatorEl.toggleClass("is-indent-selectable", hasChoice);

                this.indicatorEl.setCssStyles({
                    top: `${top}px`,
                    left: `${coords.left + offsetPx}px`,
                    width: `${Math.max(40, this.view.contentDOM.clientWidth - offsetPx)}px`,
                    display: "block"
                });
            }
        } catch {
            // Ignore if line doesn't exist
        }
    }

    private moveBlock(startBlock: { from: number, to: number, text: string, indent: number }, toLineNo: number) {
        const doc = this.view.state.doc;

        // Adopt the indent of wherever we are landing. Without this a block
        // dropped beside an indented one kept its original depth, breaking the
        // nesting and desynchronising the bullet characters that Bullet Depth
        // Markers keeps tied to depth.
        const targetIndent = this.currentTargetIndent;
        const textToMove = reindentBlock(startBlock.text, startBlock.indent, targetIndent);

        // Handle insertion at the end of the document
        if (toLineNo > doc.lines) {
            dispatchBlockEdit(this.view, {
                changes: [
                    { from: doc.length, insert: "\n" + textToMove },
                    { from: startBlock.from, to: Math.min(startBlock.to + 1, doc.length) }
                ],
                scrollIntoView: true,
                userEvent: "move.block"
            });
            return;
        }

        const toLine = doc.line(toLineNo);

        // If dropping inside the same block, do nothing
        if (toLine.from >= startBlock.from && toLine.to <= startBlock.to) return;
        
        if (startBlock.from < toLine.from) {
            // Moving down
            dispatchBlockEdit(this.view, {
                changes: [
                    { from: toLine.from, insert: textToMove + "\n" }, // Insert before the target line
                    { from: startBlock.from, to: Math.min(startBlock.to + 1, doc.length) }
                ],
                scrollIntoView: true,
                userEvent: "move.block"
            });
        } else {
            // Moving up
            dispatchBlockEdit(this.view, {
                changes: [
                    { from: toLine.from, insert: textToMove + "\n" },
                    { from: startBlock.from, to: Math.min(startBlock.to + 1, doc.length) }
                ],
                scrollIntoView: true,
                userEvent: "move.block"
            });
        }
    }
}
