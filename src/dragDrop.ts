import { dispatchBlockEdit } from "./history";
import { EditorView } from "@codemirror/view";
import { EditorSelection, Text } from "@codemirror/state";
import NotionBlock from "./main";
import {
    resolveDragRange,
    allowedIndents,
    pickIndent,
    pickIndentAtColumn,
    findDropParent,
    detectIndentUnit,
    countBlocks,
    describeDragGhost,
    LineSpan,
} from "./dragRange";
import { FrameScheduler } from "./frameScheduler";
import { planBlockMove, isNoOpMove, movedBlockRange, MoveSource } from "./planMove";
import { setDropParent } from "./dropParentTint";
import { foldHidingLineEnd } from "./blockFold";
import { FenceSpan, findFenceSpans } from "./codeFence";
import { t } from "./locale/helpers";

/**
 * Most rendered lines the drag preview clones. A long block's preview is its
 * opening lines — enough to recognise, without cloning a page of DOM.
 */
const GHOST_LINE_LIMIT = 12;

/** Past this height a block counts as tall for the drop line's edge choice. */
const TALL_BLOCK_PX = 50;
/** How close to a tall block's bottom the pointer must be to drop below it. */
const BOTTOM_EDGE_PX = 25;

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
    /** Viewport y of the document's top, the origin of CodeMirror's height map. */
    documentTop: number;
}

export class DragManager {
    private ghostEl: HTMLElement | null = null;
    /** Pointer position at the press: the preview moves by the offset from here. */
    private pressX = 0;
    private pressY = 0;
    /** Whether the ghost is cloned lines (moved by transform) or the text pill. */
    private ghostIsClone = false;
    private indicatorEl: HTMLElement | null = null;
    private isDragging = false;
    private startBlock: MoveSource | null = null;
    /**
     * The document as of drag start. `startBlock`'s offsets and text describe
     * it, so a drop is applied only while the document is still this exact
     * object (`Text` is immutable, so identity is exact). If something else
     * edited the note mid-drag (a sync reload, a linter), the drop is refused
     * rather than cutting the wrong range — the same rule obsidian-outliner
     * uses.
     */
    private startDoc: Text | null = null;
    private currentTargetLine: number | null = null;
    /** Indent the block will adopt on drop, chosen by horizontal drag position. */
    private currentTargetIndent = 0;
    /** Indent levels legal at the current drop point. One entry = no choice. */
    private currentAllowedIndents: number[] = [0];
    /** Lines a drop at the current target ignores as context; cached with the indents. */
    private currentSkips: LineSpan[] = [];
    /** Line the cached indents were computed for; null means they are stale. */
    private indentsForLine: number | null = null;
    /**
     * Fence spans as of drag start, for keeping a drop out of the middle of
     * someone's code. Read once because it is consulted on every pointer
     * frame; if the document changes mid-drag the drop is refused (see
     * `startDoc`), so these never describe a document that gets edited.
     */
    private fenceSpans: Map<number, FenceSpan> = new Map();
    /** A code block never re-indents on drop, so it is offered no choice. */
    private draggingFence = false;
    /** The drag picked up a block selection; re-select what moved. */
    private fromSelection = false;
    private indentUnit = 4;
    private metrics: DragMetrics | null = null;
    /**
     * Viewport x of the hovered line's start, and the line it was measured
     * for. Lines can sit off the content edge (themes that centre them), so it
     * is measured — but only when the pointer reaches a new line, never per
     * frame.
     */
    private lineLeft = 0;
    private lineLeftFor: number | null = null;
    /** The tinted parent span as "first:last", or null; dispatch only on change. */
    private parentKey: string | null = null;
    private ownerDocument: Document;
    private ownerWindow: Window;
    private scheduler: FrameScheduler;
    private onDragEnd?: () => void;

    private onViewportChange = () => {
        this.metrics = null;
        this.lineLeftFor = null;
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
        this.lineLeftFor = null;

        const doc = this.view.state.doc;
        this.startDoc = doc;

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
        this.draggingFence = range.isFence;
        this.fromSelection = range.fromSelection;
        this.fenceSpans = findFenceSpans(doc);

        // Preview: the block's own lines, lifted. The text pill remains for
        // a block with nothing rendered to copy.
        this.pressX = event.clientX;
        this.pressY = event.clientY;
        const lineGhost = this.buildLineGhost(range.firstLine, range.lastLine);
        this.ghostIsClone = lineGhost !== null;
        this.ghostEl = lineGhost ?? this.ownerDocument.body.createDiv({
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
        this.ownerDocument.addEventListener("keydown", this.onKeyDown, true);
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
     * Esc abandons the drag where it is: nothing moves. Capture phase, so it
     * is ours before Obsidian's own Escape handling (closing panes, Vim mode)
     * sees it.
     */
    private onKeyDown = (event: KeyboardEvent) => {
        if (!this.isDragging || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        this.currentTargetLine = null;
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
        // stopDrag clears the tint through setDropParent, which dispatches
        // unless the key already reads null. Teardown must not dispatch into
        // a view CodeMirror is in the middle of destroying.
        this.parentKey = null;
        this.stopDrag();
    }

    private stopDrag() {
        if (!this.isDragging) return;

        // Before anything else: a frame queued from the last pointer move would
        // otherwise measure against a document the drop is about to rewrite.
        this.scheduler.cancel();

        // Cleared before the move dispatches, so the tint is never mapped
        // through the edit onto lines it no longer describes.
        this.setDropParent(null);

        // Identity check: an edit from anywhere else mid-drag makes the
        // captured offsets point at different text.
        if (
            this.startBlock !== null &&
            this.currentTargetLine !== null &&
            this.view.state.doc === this.startDoc
        ) {
            this.moveBlock(this.startBlock, this.currentTargetLine);
        }

        this.isDragging = false;
        this.startBlock = null;
        this.startDoc = null;
        this.currentTargetLine = null;
        this.indentsForLine = null;
        this.metrics = null;
        this.draggingFence = false;
        this.fromSelection = false;
        this.ghostIsClone = false;
        this.parentKey = null;
        this.fenceSpans = new Map();

        if (this.ghostEl) {
            this.ghostEl.remove();
            this.ghostEl = null;
        }
        if (this.indicatorEl) {
            // Notion fades its drop line out (~150 ms) rather than blinking it
            // away. The stylesheet's opacity transition does the fade; the
            // element goes once it has finished. The local keeps hold of it
            // because the field is cleared now, ready for the next drag.
            const fading = this.indicatorEl;
            fading.removeClass("is-visible");
            this.ownerWindow.setTimeout(() => fading.remove(), 150);
            this.indicatorEl = null;
        }

        this.ownerDocument.removeEventListener("mousemove", this.onMouseMove);
        this.ownerDocument.removeEventListener("mouseup", this.onMouseUp);
        this.ownerDocument.removeEventListener("keydown", this.onKeyDown, true);
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
            documentTop: this.view.documentTop,
        };
        return this.metrics;
    }

    /**
     * One frame of drag feedback: measure everything, then paint everything.
     *
     * The ordering is the point. Positioning the ghost is a style write, and a
     * write invalidates layout — so the DOM coordinate probes that used to
     * follow it each forced the browser to recompute layout before it
     * could answer. Taking every measurement first means at most one layout pass
     * per frame instead of one per probe.
     */
    private processMove(mouseX: number, mouseY: number) {
        if (!this.isDragging || !this.startBlock) return;
        const source = this.startBlock;
        const doc = this.view.state.doc;

        // ---- READS --------------------------------------------------------
        // The height map answers "which line is at this y" from CodeMirror's
        // own bookkeeping, without asking the DOM — the same reason Notion
        // hit-tests a cached rect map instead of the page.
        const m = this.readMetrics();
        const block = this.view.lineBlockAtHeight(mouseY - m.documentTop);
        const blockTop = m.documentTop + block.top;
        if (this.lineLeftFor !== block.from) {
            this.lineLeft = this.view.coordsAtPos(block.from)?.left ?? m.contentLeft;
            this.lineLeftFor = block.from;
        }

        // ---- COMPUTE ------------------------------------------------------
        // A short block splits at its midpoint. A tall one keeps the line on
        // its top edge and switches to the bottom edge only near the bottom,
        // so a long block does not flip its drop line halfway down it
        // (docs/notion-drag-research.md §7).
        const below = block.height > TALL_BLOCK_PX
            ? mouseY >= blockTop + block.height - BOTTOM_EDGE_PX
            : mouseY > blockTop + block.height / 2;
        let top = below ? blockTop + block.height : blockTop;
        let targetLine = below ? doc.lineAt(block.to).number + 1 : doc.lineAt(block.from).number;

        // Past the midpoint of a FOLDED block's head line, the line after it
        // is the first hidden one. Stepping to the line after the fold puts
        // the block where the indicator is actually drawn: below the whole
        // block.
        const hiddenUntil = foldHidingLineEnd(this.view, targetLine);
        if (hiddenUntil !== null) targetLine = hiddenUntil + 1;

        // A drop past the opening fence would splice the dragged block between
        // two lines of someone's code. Stepping past the closer puts it below
        // the whole thing. Landing ON the opening fence is a drop above the
        // block and stays where it is.
        const fence = this.fenceSpans.get(targetLine);
        if (fence && targetLine > fence.firstLine) {
            targetLine = fence.lastLine + 1;
            // The line has to follow the drop: left at the pointer's block it
            // would be drawn inside the code while the block lands after it.
            // The height map gives the closer's bottom without a layout pass.
            top = m.documentTop + this.view.lineBlockAt(doc.line(fence.lastLine).to).bottom;
        }

        this.currentTargetLine = targetLine;

        // A document walk, and the document is fixed for the drag (a drop onto
        // a changed document is refused), so it is recomputed only when the
        // drop point moves to a different line.
        if (this.indentsForLine !== targetLine) {
            // The dragged block's own lines are leaving, so they are context
            // for nothing: not the line above, not the line below, not a
            // parent.
            const skips: LineSpan[] = [{ firstLine: source.firstLine, lastLine: source.lastLine }];

            // Just below a FOLDED block, its hidden lines are not there to be
            // nested under. Notion never offers a closed block's interior, and
            // the height map's block for the line above covers head plus
            // hidden lines, so its own extent says which lines to ignore. This
            // is keyed on the target line, not the pointer, so the same drop
            // point reached from the next block's upper half behaves the same.
            if (targetLine > 1 && foldHidingLineEnd(this.view, targetLine - 1) !== null) {
                const above = this.view.lineBlockAt(doc.line(targetLine - 1).from);
                const headLine = doc.lineAt(above.from).number;
                const lastHidden = doc.lineAt(above.to).number;
                if (lastHidden > headLine) skips.push({ firstLine: headLine + 1, lastLine: lastHidden });
            }

            this.currentSkips = skips;
            this.currentAllowedIndents = allowedIndents(doc, targetLine, this.indentUnit, skips);
            this.indentsForLine = targetLine;
        }

        // A code block keeps the indent it already had, whatever the pointer
        // is doing horizontally — a fence indented four columns outside a list
        // stops being read as a fence at all. Everything else takes the
        // deepest level whose edge the pointer has passed.
        this.currentTargetIndent = this.draggingFence
            ? pickIndent(this.currentAllowedIndents, source.indent)
            : pickIndentAtColumn(this.currentAllowedIndents, (mouseX - this.lineLeft) / m.columnPx);

        const noOp = isNoOpMove(source, targetLine, this.currentTargetIndent);
        const parent = noOp ? null : findDropParent(doc, targetLine, this.currentTargetIndent, this.currentSkips);
        const offsetPx = this.currentTargetIndent * m.columnPx;

        // ---- WRITES -------------------------------------------------------
        this.updateGhostPosition(mouseX, mouseY);

        if (this.indicatorEl) {
            // Over a drop that would change nothing there is nothing to show.
            // Notion draws no line over the dragged block itself.
            this.indicatorEl.toggleClass("is-indent-selectable", !this.draggingFence && this.currentAllowedIndents.length > 1);
            this.indicatorEl.toggleClass("is-visible", !noOp);
            this.indicatorEl.setCssStyles({
                top: `${top}px`,
                left: `${this.lineLeft + offsetPx}px`,
                width: `${Math.max(40, m.contentWidth - offsetPx)}px`,
            });
        }

        this.setDropParent(parent);
    }

    /** Tints the would-be parent; a transaction only when it changes. */
    private setDropParent(span: LineSpan | null) {
        const key = span ? `${span.firstLine}:${span.lastLine}` : null;
        if (key === this.parentKey) return;
        this.parentKey = key;
        // destroy() ends a drag while its view is being torn down; a detached
        // view has nothing left to paint a tint on.
        if (!this.view.dom.isConnected) return;
        this.view.dispatch({ effects: setDropParent.of(span) });
    }

    private updateGhostPosition(x: number, y: number) {
        if (!this.ghostEl) return;
        if (this.ghostIsClone) {
            // A composited transform: no layout, whatever the block contains.
            this.ghostEl.style.transform =
                `translate3d(${x - this.pressX}px, ${y - this.pressY}px, 0)`;
            return;
        }
        this.ghostEl.setCssStyles({
            left: `${x + 10}px`,
            top: `${y + 10}px`
        });
    }

    /**
     * A copy of the block's own rendered lines, pinned where they are now.
     *
     * Notion's preview is the block itself lifted off the page, so the point
     * you grabbed stays under the pointer. Mounted inside the editor's root
     * (never inside contentDOM, which CodeMirror owns) so theme styles that
     * key off the editor still apply to the copies. Null when no line of the
     * block is rendered, in which case the caller falls back to the text pill.
     */
    private buildLineGhost(firstLine: number, lastLine: number): HTMLElement | null {
        const doc = this.view.state.doc;
        const lines: HTMLElement[] = [];

        for (let n = firstLine; n <= lastLine && lines.length < GHOST_LINE_LIMIT; n++) {
            const from = doc.line(n).from;
            if (from < this.view.viewport.from || from > this.view.viewport.to) continue;
            const node = this.view.domAtPos(from).node;
            const el = (node instanceof HTMLElement ? node : node.parentElement)?.closest(".cm-line");
            if (el instanceof HTMLElement && !lines.includes(el)) lines.push(el);
        }
        if (lines.length === 0) return null;

        // Every line is measured before anything is mounted, so the clone
        // writes below add no layout pass of their own.
        const rects = lines.map((el) => el.getBoundingClientRect());

        const box = this.view.dom.createDiv({
            // The box takes the real content's own classes (cm-content,
            // cm-lineWrapping, theme classes) so the copies wrap exactly like
            // the editor. cm-content alone is `white-space: pre`, which would
            // render a wrapped paragraph as one long row.
            cls: `${this.view.contentDOM.className} block-drag-ghost-lines`,
        });

        // position: fixed is relative to the viewport only when no ancestor
        // has a transform, filter or containment (Hover Editor popovers,
        // stacked tabs, some themes). The empty box sits at fixed 0,0 by CSS,
        // so where it actually landed is the offset to subtract.
        const origin = box.getBoundingClientRect();

        lines.forEach((el, i) => {
            const clone = el.cloneNode(true) as HTMLElement;
            clone.setCssStyles({
                position: "fixed",
                left: `${rects[i].left - origin.left}px`,
                top: `${rects[i].top - origin.top}px`,
                width: `${rects[i].width}px`,
                // rects are border boxes and .cm-line has horizontal padding.
                boxSizing: "border-box",
                margin: "0",
            });
            box.appendChild(clone);
        });
        return box;
    }

    private moveBlock(startBlock: MoveSource, toLineNo: number) {
        const doc = this.view.state.doc;
        const changes = planBlockMove(doc, startBlock, toLineNo, this.currentTargetIndent);

        if (changes.length === 0) return;

        // Only a drag that picked up a block selection keeps one. Selecting a
        // single dragged block would make the next keystroke replace it.
        const landed = this.fromSelection ? movedBlockRange(doc, changes) : null;

        dispatchBlockEdit(this.view, {
            changes,
            selection: landed ? EditorSelection.range(landed.from, landed.to) : undefined,
            scrollIntoView: true,
            userEvent: "move.block"
        });
    }
}
