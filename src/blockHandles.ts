import { 
    EditorView, 
    ViewPlugin, 
    ViewUpdate
} from "@codemirror/view";
import { setIcon, Menu } from "obsidian";
import NotionBlock from "./main";
import { closeNotionBlockActionMenus, showNotionBlockActionMenu } from "./notionActionMenu";
import { closeNotionBlockInsertMenus, showNotionBlockInsertMenu } from "./notionInsertMenu";
import { DragManager } from "./dragDrop";
import { FrameScheduler } from "./frameScheduler";
import { t } from "./locale/helpers";

/**
 * Editor geometry that a pointer move needs but cannot change.
 *
 * Every field here comes from a layout read — getBoundingClientRect, offsetLeft,
 * scrollTop. Reading one costs nothing on its own, but reading one AFTER a style
 * write forces the browser to recompute layout synchronously before it can
 * answer. Gathering them into a single struct lets the hot path take them all at
 * once, and hold them until something actually invalidates them.
 */
interface Metrics {
    viewTop: number;
    viewLeft: number;
    viewWidth: number;
    viewHeight: number;
    /** Viewport-space left edge of the content, for probing a line by its Y. */
    contentLeft: number;
    /** Offset of the content inside the scroller, for placing the handle. */
    contentOffsetLeft: number;
    scrollerTop: number;
    scrollTop: number;
}

export const blockHandlesExtension = (plugin: NotionBlock) => ViewPlugin.fromClass(class {
    handleEl: HTMLElement | null = null;
    addButton: HTMLElement | null = null;
    dragButton: HTMLElement | null = null;
    
    hoveredLine: number | null = null;
    hideTimeout: number | null = null;
    dragManager: DragManager | null = null;
    ownerWindow: Window;
    isMouseOverHandle = false;

    /** Collapses a burst of pointer moves into one pass per frame. */
    scheduler: FrameScheduler;

    /**
     * Viewport-space Y span of the hovered line, including its wrapped rows.
     *
     * Most pointer moves stay inside the line they are already on. Without this
     * every one of them ran a posAtCoords probe purely to rediscover a line
     * number that had not changed. Held in viewport coordinates so it can be
     * compared against clientY directly, which means scrolling invalidates it.
     */
    hoveredBand: { top: number; bottom: number } | null = null;

    metrics: Metrics | null = null;

    /** The handle is a fixed size in CSS, so this is read once and kept. */
    handleHeight = 0;

    /** Last value written to the "+" button, so an unchanged setting writes nothing. */
    plusHandleShown: boolean | null = null;

    /** Held directly: CodeMirror's destroy() is passed no view to ask for it. */
    scrollEl: HTMLElement;

    onScroll = () => this.invalidateMetrics();
    onResize = () => this.invalidateMetrics();

    constructor(view: EditorView) {
        this.ownerWindow = view.dom.ownerDocument.defaultView ?? activeWindow;
        this.scheduler = new FrameScheduler(this.ownerWindow);
        this.scrollEl = view.scrollDOM;
        this.createHandle(view);

        // Both cached rects and the hovered band are viewport-relative, so they
        // stop being true the moment the editor scrolls or the window resizes.
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
        this.ownerWindow.addEventListener("resize", this.onResize);
    }

    createHandle(view: EditorView) {
        // Create handle directly as child of scrollDOM (not activeDocument which throws HierarchyRequestError)
        this.handleEl = view.scrollDOM.createDiv();
        this.handleEl.className = "block-handle-wrap is-hidden";
        
        this.addButton = this.handleEl.createDiv({ 
            cls: "block-handle-button add-button", 
            attr: { "aria-label": t("handles.addBlock") } 
        });
        setIcon(this.addButton, "plus");
        
        this.dragButton = this.handleEl.createDiv({ 
            cls: "block-handle-button drag-button", 
            attr: { "aria-label": t("handles.dragReorder") } 
        });
        setIcon(this.dragButton, "grip-vertical");
        
        // Track mouse hover state explicitly to bypass cross-window :hover matching issues
        this.handleEl.addEventListener("mouseenter", () => {
            this.isMouseOverHandle = true;
            if (this.hideTimeout) {
                this.ownerWindow.clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        });
        this.handleEl.addEventListener("mouseleave", () => {
            this.isMouseOverHandle = false;
            this.handleMouseLeave();
        });

        // Drag & Menu Logic
        let dragTimeout: number | null = null;
        let isDragging = false;

        this.dragButton.onmousedown = (e) => {
            if (this.hoveredLine === null) return;
            if (this.hideTimeout) {
                this.ownerWindow.clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
            e.preventDefault();
            e.stopPropagation();
            
            isDragging = false;
            dragTimeout = this.ownerWindow.setTimeout(() => {
                isDragging = true;
                if (!this.dragManager) {
                    this.dragManager = new DragManager(plugin, view);
                }
                this.dragManager.startDrag(this.hoveredLine!, e, () => {
                    // The document just changed under us, so any remembered
                    // line number is meaningless. Clearing it forces the next
                    // pointer move to resolve the line afresh.
                    this.hoveredLine = null;
                    this.hoveredBand = null;
                    this.isMouseOverHandle = false;
                });
            }, 150);
        };

        this.dragButton.onmouseup = (_e: MouseEvent) => {
            if (dragTimeout !== null) this.ownerWindow.clearTimeout(dragTimeout);
            if (!isDragging && this.hoveredLine !== null) {
                const rect = this.dragButton!.getBoundingClientRect();
                closeNotionBlockInsertMenus();
                showNotionBlockActionMenu(
                    plugin,
                    view,
                    this.hoveredLine,
                    { x: rect.left, y: rect.bottom },
                    { avoid: { top: rect.top, bottom: rect.bottom } }
                );
            }
        };

        this.dragButton.onclick = (e) => e.stopPropagation();

        this.dragButton.oncontextmenu = (e) => {
            const menu = new Menu();
            menu.addItem(item => {
                item.setTitle(plugin.settings.dragGranularity === "line" ? t("handles.switchToParagraph") : t("handles.switchToLine"))
                    .setIcon("layers")
                    .onClick(async () => {
                        plugin.settings.dragGranularity = plugin.settings.dragGranularity === "line" ? "paragraph" : "line";
                        await plugin.saveSettings();
                    });
            });
            menu.showAtMouseEvent(e);
            e.preventDefault();
        };

        this.addButton.onclick = (e) => {
            if (this.hoveredLine === null) return;
            if (this.hideTimeout) {
                this.ownerWindow.clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
            e.stopPropagation();
            
            const rect = this.addButton!.getBoundingClientRect();
            const pos = { x: rect.left, y: rect.bottom };

            // Just show the menu for the current line.
            // insertBlock will handle creating a new line if the current one isn't empty.
            closeNotionBlockActionMenus();
            showNotionBlockInsertMenu(plugin, view, this.hoveredLine, pos, {
                avoid: { top: rect.top, bottom: rect.bottom },
            });
        };

    }

    /** Drops cached geometry so the next read takes it afresh. */
    invalidateMetrics() {
        this.metrics = null;
        this.hoveredBand = null;
    }

    /**
     * Cached editor geometry, measured only when the cache is cold.
     *
     * Every read is taken in one uninterrupted run. Interleaving a style write
     * would force a separate layout pass for each read that followed it.
     */
    readMetrics(view: EditorView): Metrics {
        if (this.metrics) return this.metrics;

        const viewRect = view.dom.getBoundingClientRect();
        const contentRect = view.contentDOM.getBoundingClientRect();
        const scrollerRect = view.scrollDOM.getBoundingClientRect();

        this.metrics = {
            viewTop: viewRect.top,
            viewLeft: viewRect.left,
            viewWidth: viewRect.width,
            viewHeight: viewRect.height,
            contentLeft: contentRect.left,
            contentOffsetLeft: view.contentDOM.offsetLeft,
            scrollerTop: scrollerRect.top,
            scrollTop: view.scrollDOM.scrollTop,
        };
        return this.metrics;
    }

    update(update: ViewUpdate) {
        // Any of these can move the line the handle is pinned to, so the cached
        // rects and the hovered band both stop being trustworthy.
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
            this.invalidateMetrics();
            if (this.hoveredLine !== null) {
                this.updatePosition(update.view);
            }
        }
    }

    updatePosition(view: EditorView) {
        if (this.hoveredLine === null || !this.handleEl) return;

        try {
            const line = view.state.doc.line(this.hoveredLine);

            // ---- READS ----------------------------------------------------
            // Everything measured here happens before the first write below.
            // A write in the middle would force layout to be recomputed before
            // each remaining read could be answered.
            const coords = view.coordsAtPos(line.from);
            if (!coords) return;

            // The end of the line, so a wrapped paragraph's band covers all of
            // its visual rows rather than only the first.
            const endCoords = view.coordsAtPos(line.to);
            const m = this.readMetrics(view);
            if (this.handleHeight === 0) {
                this.handleHeight = this.handleEl.offsetHeight || 24;
            }

            // Calculate top relative to scrollDOM
            // (coords.top - scrollerTop) is the viewport-relative offset
            // We add scrollTop because handleEl is a child of scrollDOM
            let top = (coords.top - m.scrollerTop) + m.scrollTop;

            // Centering logic:
            // Adjust to the vertical center of the first visual line
            const lineHeight = coords.bottom - coords.top;
            top += (lineHeight - this.handleHeight) / 2;

            // Calculate left position based on contentDOM offset
            const left = m.contentOffsetLeft - 52;

            this.hoveredBand = { top: coords.top, bottom: (endCoords ?? coords).bottom };

            // ---- WRITES ---------------------------------------------------
            // Re-read the setting on every reposition rather than at
            // construction: the plugin instance outlives a settings change, so
            // a toggle applied once at startup would not take effect until the
            // editor was rebuilt. Only touch the DOM when it actually differs.
            if (this.plusHandleShown !== plugin.settings.plusHandle) {
                this.plusHandleShown = plugin.settings.plusHandle;
                this.addButton?.toggle(plugin.settings.plusHandle);
            }

            this.handleEl.setCssStyles({ transform: `translate3d(${left}px, ${Math.round(top)}px, 0)` });
        } catch {
            this.hideHandle();
        }
    }

    /**
     * Queues a pointer move for the next frame.
     *
     * Only the coordinates and the hit-test result are kept, not the event: the
     * hit test walks the DOM tree rather than measuring it, so it is cheap to do
     * now and would be wrong to defer — by the next frame the pointer may have
     * left the element the event was actually about.
     */
    handleMouseMove(view: EditorView, event: MouseEvent) {
        const clientX = event.clientX;
        const clientY = event.clientY;
        const overHandle = !!(event.target as HTMLElement).closest(".block-handle-wrap");

        this.scheduler.schedule(() => this.processMouseMove(view, clientX, clientY, overHandle));
    }

    processMouseMove(view: EditorView, clientX: number, clientY: number, overHandle: boolean) {
        if (!this.handleEl) return;

        const m = this.readMetrics(view);
        const x = clientX - m.viewLeft;
        const y = clientY - m.viewTop;

        // Detection range check - Expand left range to accommodate the handle
        if (x < -100 || x > m.viewWidth + 100 || y < 0 || y > m.viewHeight) {
            this.handleMouseLeave();
            return;
        }

        if (overHandle) {
            if (this.hideTimeout) {
                this.ownerWindow.clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
            if (this.handleEl.classList.contains("is-hidden")) {
                this.handleEl.classList.remove("is-hidden");
                // If it was fully nullified, try to recover the line from current Y
                if (this.hoveredLine === null) {
                    const pos = view.posAtCoords({ x: m.contentLeft + 5, y: clientY });
                    if (pos !== null) {
                        try {
                            this.hoveredLine = view.state.doc.lineAt(pos).number;
                        } catch {
                            /* position may be invalid during document changes */
                        }
                    }
                }
                this.updatePosition(view);
            }
            return;
        }

        const isHidden = this.handleEl.classList.contains("is-hidden");

        // The pointer has not left the line it was already on, and the handle is
        // already parked there. Nothing to measure and nothing to move.
        if (
            !isHidden &&
            this.hoveredLine !== null &&
            this.hoveredBand !== null &&
            clientY >= this.hoveredBand.top &&
            clientY < this.hoveredBand.bottom
        ) {
            if (this.hideTimeout) {
                this.ownerWindow.clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
            return;
        }

        // Use a fixed X point inside content to find the line at current Y
        const pos = view.posAtCoords({ x: m.contentLeft + 5, y: clientY });
        if (pos === null) return;

        try {
            const line = view.state.doc.lineAt(pos);
            // Update when the line changed, OR when the handle is hidden even
            // though the pointer is over a valid line.
            //
            // The second half fixes handles that stopped appearing after a
            // drag. A drag rewrites the document, so hoveredLine can still
            // hold a number that now refers to different content; landing on a
            // line with that same number left this guard satisfied and the
            // handle stayed hidden until the pointer crossed into a
            // differently-numbered line.
            if (this.hoveredLine !== line.number || isHidden) {
                this.hoveredLine = line.number;
                this.handleEl.classList.remove("is-hidden");
                this.updatePosition(view);
            }

            if (this.hideTimeout) {
                this.ownerWindow.clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        } catch {
            // Document might be changing
        }
    }

    handleMouseLeave() {
        // A pointer move queued for the next frame would run after this one and
        // clear the hide timeout set below, leaving the handle stranded on
        // screen after the pointer had already left the editor.
        this.scheduler.cancel();

        if (this.hideTimeout) this.ownerWindow.clearTimeout(this.hideTimeout);
        
        this.hideTimeout = this.ownerWindow.setTimeout(() => {
            // Check if mouse is actually over the handle or we are still hovering
            if (this.isMouseOverHandle || this.handleEl?.matches(":hover")) {
                return;
            }
            this.hoveredLine = null;
            this.hoveredBand = null;
            this.handleEl?.classList.add("is-hidden");
        }, plugin.settings.hideDelay);
    }

    hideHandle() {
        this.hoveredLine = null;
        this.hoveredBand = null;
        if (this.handleEl) {
            this.handleEl.classList.add("is-hidden");
        }
        if (this.hideTimeout) {
            this.ownerWindow.clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    destroy() {
        closeNotionBlockActionMenus();
        closeNotionBlockInsertMenus();
        // A queued frame closes over the view, so letting it fire after teardown
        // would measure and position against a detached editor.
        this.scheduler.cancel();
        if (this.hideTimeout) {
            this.ownerWindow.clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
        this.scrollEl.removeEventListener("scroll", this.onScroll);
        this.ownerWindow.removeEventListener("resize", this.onResize);
        // The drag manager's listeners are on the document, not on the view, so
        // they outlive the view unless it says so explicitly.
        this.dragManager?.destroy();
        this.dragManager = null;
        if (this.handleEl) {
            this.handleEl.remove();
        }
    }
}, {
    eventHandlers: {
        mousemove(event, _view) {
            this.handleMouseMove(_view, event);
        },
        mouseleave(_event, _view) {
            this.handleMouseLeave();
        }
    }
});
