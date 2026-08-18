import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import NotionBlock from "./main";
import { InsertMenuHandle, showNotionBlockInsertMenu } from "./notionInsertMenu";
import { closeNotionBlockActionMenus } from "./notionActionMenu";
import { isSlashTriggerPosition, normaliseTrigger, readSlashQuery } from "./slashTrigger";
import { isInsideCodeFence } from "./codeFence";

/**
 * Types the trigger character, gets the insert menu — the same menu the "+"
 * handle opens, so there is one list of block types rather than two that drift
 * apart.
 *
 * The menu stays open while typing continues, filtering as it goes, and the
 * whole `/query` is deleted by the insert itself so it never survives into the
 * note and the insert costs one undo press.
 */
export const slashMenuExtension = (plugin: NotionBlock) =>
    ViewPlugin.fromClass(
        class {
            private menu: InsertMenuHandle | null = null;
            private triggerPos: number | null = null;
            private pendingOpen: number | null = null;
            private readonly ownerWindow: Window;

            constructor(view: EditorView) {
                this.ownerWindow = view.dom.ownerDocument.defaultView ?? activeWindow;
            }

            update(update: ViewUpdate): void {
                if (this.menu) {
                    this.syncOrClose(update);
                    return;
                }
                if (!update.docChanged) return;
                if (!plugin.settings.enabled || !plugin.settings.slashMenu) return;

                const trigger = normaliseTrigger(plugin.settings.slashTrigger);
                if (!trigger) return;

                // Only a keystroke opens the menu. Without this, a paste or an
                // edit from another plugin that happened to end in "/" would
                // pop a menu the user never asked for.
                if (!update.transactions.some((tr) => tr.isUserEvent("input.type"))) return;

                const { state } = update;
                if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return;

                const head = state.selection.main.head;
                const line = state.doc.lineAt(head);
                const col = head - line.from;
                if (col < trigger.length) return;
                if (line.text.slice(col - trigger.length, col) !== trigger) return;
                const before = line.text.slice(0, col - trigger.length);
                if (!isSlashTriggerPosition(before, plugin.settings.slashInline)) return;
                if (isInsideCodeFence(state.doc, line.number)) return;

                this.scheduleOpen(update.view, head - trigger.length);
            }

            /**
             * Opens on the next tick rather than inside the update.
             *
             * Positioning the menu needs coordsAtPos, and CodeMirror forbids
             * reading layout while an update is in flight — it throws rather
             * than returning a stale measurement.
             */
            private scheduleOpen(view: EditorView, triggerPos: number): void {
                this.triggerPos = triggerPos;
                this.pendingOpen = this.ownerWindow.setTimeout(() => {
                    this.pendingOpen = null;
                    if (this.triggerPos !== triggerPos || this.menu) return;

                    const coords = view.coordsAtPos(triggerPos);
                    if (!coords) {
                        this.triggerPos = null;
                        return;
                    }

                    closeNotionBlockActionMenus();
                    const line = view.state.doc.lineAt(triggerPos);
                    this.menu = showNotionBlockInsertMenu(
                        plugin,
                        view,
                        line.number,
                        { x: coords.left, y: coords.bottom + 6 },
                        {
                            avoid: { top: coords.top, bottom: coords.bottom },
                            replaceFrom: triggerPos,
                            keepEditorFocus: true,
                            onClose: () => {
                                this.menu = null;
                                this.triggerPos = null;
                            },
                        }
                    );
                }, 0);
            }

            private syncOrClose(update: ViewUpdate): void {
                if (!update.docChanged && !update.selectionSet) return;

                const menu = this.menu;
                const triggerPos = this.triggerPos;
                if (!menu || triggerPos === null) return;

                const { state } = update;
                if (triggerPos >= state.doc.length + 1) {
                    menu.close();
                    return;
                }

                const line = state.doc.lineAt(triggerPos);
                const head = state.selection.main.head;
                if (head < line.from || head > line.to) {
                    menu.close();
                    return;
                }

                const trigger = normaliseTrigger(plugin.settings.slashTrigger) ?? "/";
                const query = readSlashQuery(
                    line.text,
                    triggerPos - line.from,
                    head - line.from,
                    trigger
                );
                if (query === null) {
                    menu.close();
                    return;
                }
                if (!menu.setQuery(query)) menu.close();
            }

            destroy(): void {
                if (this.pendingOpen !== null) this.ownerWindow.clearTimeout(this.pendingOpen);
                this.menu?.close();
            }
        }
    );
