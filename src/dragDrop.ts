import { dispatchBlockEdit } from "./history";
import { EditorView } from "@codemirror/view";
import NotionBlock from "./main";
import {
    resolveDragRange,
    allowedIndents,
    pickIndent,
    detectIndentUnit,
    countBlocks,
    describeDragGhost,
} from "./dragRange";
import { FrameScheduler } from "./frameScheduler";
import { planBlockMove, MoveSource } from "./planMove";
import { t } from "./locale/helpers";

/**
 * Editor geometry a drag needs but does not itself change.
 *
 * The content's left edge, its width and the character width are fixed for the
 * length of a drag — only scrolling or resizing can move them. Reading them once
 * keeps the per-frame work down to the two line probes that genuinely vary.
 */
interface DragMetrics {
    contentLeft: number;
    contentWidth: number;
    columnPx: number;
}

export class DragManager {
    private ghostEl: HTMLElement | null = null;
    private indicatorEl: HTMLElement | null = null;
    private isDragging = false;
    private startBlock: MoveSource | null = null;
    private currentTargetLine: number | null = null;
    /** Indent the block will adopt on drop, chosen by horizontal drag position. */
    private currentTargetIndent = 0;
    /** Indent levels legal at the current drop point. One entry = no choice. */
    private currentAllowedIndents: number[] = [0];
    /** Line the cached indents were computed for; null means they are stale. */
    private indentsForLine: number | null = null;
    private indentUnit = 4;
    private metrics: DragMetrics | null = null;
    private ownerDocument: Document;
    private ownerWindow: Window;
    private scheduler: FrameScheduler;
    private onDragEnd?: () => void;

    private onViewportChange = () => {
        this.metrics = null;
    };

    constructor(private plugin: NotionBlock, private view: EditorView) {
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = this.ownerDocument.defaultView ?? activeWindow;
        this.scheduler = new FrameScheduler(this.ownerWindow);
    }

    startDrag(lineNo: number, event: MouseEvent, onDragEnd?: () => void) {
        this.onDragEnd = onDragEnd;
        this.isDragging = true;
        this.metrics = null;
        this.indentsForLine = null;

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

        this.startBlock = {
            from: fromPos,
            to: toPos,
            text,
            indent: range.indent,
            firstLine: range.firstLine,
            lastLine: range.lastLine,
        };
        this.indentUnit = detectIndentUnit(doc);

        // Create ghost element
        this.ghostEl = this.ownerDocument.body.createDiv({
            cls: "block-drag-ghost",
            text: describeDragGhost(
                text,
                countBlocks(doc, range.firstLine, range.lastLine),
                t("drag.blocks")
            ),
        });
        this.updateGhostPosition(event.clientX, event.clientY);

        // Create indicator line
        this.indicatorEl = this.ownerDocument.body.createDiv({
            cls: "block-drag-indicator"
        });

        this.ownerDocument.addEventListener("mousemove", this.onMouseMove);
        this.ownerDocument.addEventListener("mouseup", this.onMouseUp);
        this.view.scrollDOM.addEventListener("scroll", this.onViewportChange, { passive: true });
        this.ownerWindow.addEventListener("resize", this.onViewportChange);
        
        // Prevent text selection during drag
        this.ownerDocument.body.addClass("is-dragging-block");
    }

    /**
     * Records where the pointer is and defers the work to the next frame.
     *
     * A mouse reports movement several times per painted frame, and every extra
     * report used to repeat the full measure-and-position pass. Only the newest
     * position matters, so keeping it and running once per frame drops the work
     * to what the screen can actually show.
     */
    private onMouseMove = (event: MouseEvent) => {
        if (!this.isDragging) return;
        const x = event.clientX;
        const y = event.clientY;
        this.scheduler.schedule(() => this.processMove(x, y));
    };

    private onMouseUp = (event: MouseEvent) => {
        // The final pointer move may still be sitting in a frame that will never
        // get to run, which would drop the block at wherever the pointer was one
        // frame ago. Resolve the drop point from where the button was actually
        // released, then apply.
        if (this.isDragging) {
            this.scheduler.cancel();
            this.processMove(event.clientX, event.clientY);
        }
        this.stopDrag();
    };

    /**
     * Tears down a drag in progress without applying it.
     *
     * The mousemove and mouseup listeners live on the document, so a view torn
     * down mid-drag — closing the pane, disabling the plugin — would otherwise
     * leave them attached to a view that no longer exists.
     */
    destroy() {
        this.startBlock = null;
        this.currentTargetLine = null;
        this.stopDrag();
    }

    private stopDrag() {
        if (!this.isDragging) return;

        // Before anything else: a frame queued from the last pointer move would
        // otherwise measure against a document the drop is about to rewrite.
        this.scheduler.cancel();

        if (this.startBlock !== null && this.currentTargetLine !== null) {
            this.moveBlock(this.startBlock, this.currentTargetLine);
        }

        this.isDragging = false;
        this.startBlock = null;
        this.currentTargetLine = null;
        this.indentsForLine = null;
        this.metrics = null;

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
        this.view.scrollDOM.removeEventListener("scroll", this.onViewportChange);
        this.ownerWindow.removeEventListener("resize", this.onViewportChange);
        this.ownerDocument.body.removeClass("is-dragging-block");

        // Let the handle drop its cached line number — the drag has rewritten
        // the document, so that number no longer means what it did.
        this.onDragEnd?.();
    }

    private readMetrics(): DragMetrics {
        if (this.metrics) return this.metrics;

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        this.metrics = {
            contentLeft: contentRect.left,
            contentWidth: this.view.contentDOM.clientWidth,
            columnPx: this.view.defaultCharacterWidth || 8,
        };
        return this.metrics;
    }

    /**
     * One frame of drag feedback: measure everything, then paint everything.
     *
     * The ordering is the point. Positioning the ghost is a style write, and a
     * write invalidates layout — so the posAtCoords and coordsAtPos probes that
     * used to follow it each forced the browser to recompute layout before it
     * could answer. Taking every measurement first means at most one layout pass
     * per frame instead of one per probe.
     */
    private processMove(mouseX: number, mouseY: number) {
        if (!this.isDragging) return;

        // ---- READS --------------------------------------------------------
        const m = this.readMetrics();
        const pos = this.view.posAtCoords({ x: mouseX, y: mouseY });

        let paint: { top: number; left: number; width: number; hasChoice: boolean } | null = null;

        if (pos !== null) {
            try {
                const line = this.view.state.doc.lineAt(pos);
                const coords = this.view.coordsAtPos(line.from);
                const endCoords = coords ? this.view.coordsAtPos(line.to) : null;

                if (coords) {
                    // ---- COMPUTE ------------------------------------------
                    let top = coords.top;
                    let targetLine = line.number;

                    if (endCoords) {
                        const lineBottom = endCoords.bottom;
                        const midPoint = coords.top + (lineBottom - coords.top) / 2;
                        if (mouseY > midPoint) {
                            top = lineBottom;
                            targetLine = line.number + 1;
                        }
                    }

                    this.currentTargetLine = targetLine;

                    // Horizontal drag position chooses the drop depth, snapped to
                    // the levels that are actually legal here. Where only one is
                    // legal there is nothing to choose and the indicator sits flush,
                    // which is the behaviour in a document with no lists.
                    //
                    // The legal set is a document walk, and the document cannot
                    // change mid-drag, so it is recomputed only when the drop
                    // point moves to a different line.
                    if (this.indentsForLine !== targetLine) {
                        this.currentAllowedIndents = allowedIndents(
                            this.view.state.doc,
                            targetLine,
                            this.indentUnit
                        );
                        this.indentsForLine = targetLine;
                    }

                    const desired = Math.max(0, Math.round((mouseX - m.contentLeft) / m.columnPx));
                    this.currentTargetIndent = pickIndent(this.currentAllowedIndents, desired);

                    const offsetPx = this.currentTargetIndent * m.columnPx;
                    paint = {
                        top,
                        left: coords.left + offsetPx,
                        width: Math.max(40, m.contentWidth - offsetPx),
                        hasChoice: this.currentAllowedIndents.length > 1,
                    };
                }
            } catch {
                // Line doesn't exist — leave the indicator where it was.
            }
        }

        // ---- WRITES -------------------------------------------------------
        this.updateGhostPosition(mouseX, mouseY);

        if (paint && this.indicatorEl) {
            this.indicatorEl.toggleClass("is-indent-selectable", paint.hasChoice);
            this.indicatorEl.setCssStyles({
                top: `${paint.top}px`,
                left: `${paint.left}px`,
                width: `${paint.width}px`,
                display: "block"
            });
        }
    }

    private updateGhostPosition(x: number, y: number) {
        if (this.ghostEl) {
            this.ghostEl.setCssStyles({
                left: `${x + 10}px`,
                top: `${y + 10}px`
            });
        }
    }

    private moveBlock(startBlock: MoveSource, toLineNo: number) {
        const changes = planBlockMove(
            this.view.state.doc,
            startBlock,
            toLineNo,
            this.currentTargetIndent
        );

        if (changes.length === 0) return;

        dispatchBlockEdit(this.view, {
            changes,
            scrollIntoView: true,
            userEvent: "move.block"
        });
    }
}
