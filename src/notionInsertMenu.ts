import { setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import NotionBlock from "./main";
import {
    RemoveRange,
    insertAttachmentFiles,
    insertBlock,
    insertImageFiles,
    insertNewPage,
    insertTableOfContents,
} from "./blockTransform";
import { matchesQuery } from "./slashTrigger";
import { placeMenu, placeSubmenu } from "./menuPosition";
import { t } from "./locale/helpers";
import {
    BUILTIN_ITEMS,
    InsertSectionKey,
    ResolvedItem,
    groupBySection,
    resolveMenuItems,
} from "./insertRegistry";

type InsertPage = "callout";
type InsertAction = () => boolean | void;

interface InsertItem {
    id: string;
    label: string;
    icon: string;
    /** Extra terms the slash query can match, e.g. "h1" for Heading 1. */
    keywords?: string[];
    page?: InsertPage;
    action?: InsertAction;
}

interface InsertSection {
    title: string;
    items: InsertItem[];
}

interface CalloutOption {
    type: string;
    label: string;
}

interface MenuPosition {
    x: number;
    y: number;
}

export interface InsertMenuOptions {
    /**
     * Screen rectangle the menu must not cover — the line the caret is on.
     *
     * Without it the menu is merely clamped into the window, and a menu taller
     * than the space below the caret slides up over the very text being typed:
     * the filter still works, but blind.
     */
    avoid?: { top: number; bottom: number };
    /**
     * Document offset of the trigger character. Everything from here to the
     * caret is deleted as part of the insert, so the `/query` never survives
     * into the note and the whole thing is one undo step.
     */
    replaceFrom?: number;
    /** Leave focus in the editor so typing keeps filtering the menu. */
    keepEditorFocus?: boolean;
    onClose?: () => void;
}

/** What the slash-menu driver needs from an open menu. */
export interface InsertMenuHandle {
    /** Re-filters the menu. Returns false when nothing matches any more. */
    setQuery(query: string): boolean;
    close(): void;
}

const CALLOUT_OPTIONS: CalloutOption[] = [
    { type: "note", label: "note" },
    { type: "info", label: "info" },
    { type: "todo", label: "todo" },
    { type: "tip", label: "tip" },
    { type: "success", label: "success" },
    { type: "question", label: "question" },
    { type: "warning", label: "warning" },
    { type: "failure", label: "failure" },
    { type: "danger", label: "danger" },
    { type: "bug", label: "bug" },
    { type: "example", label: "example" },
    { type: "quote", label: "quote" },
];

const CALLOUT_ICONS: Record<string, string> = {
    note: "pencil",
    abstract: "clipboard-list",
    summary: "clipboard-list",
    tldr: "clipboard-list",
    info: "info",
    todo: "check-circle",
    tip: "flame",
    hint: "flame",
    important: "flame",
    success: "check",
    check: "check",
    done: "check",
    question: "help-circle",
    help: "help-circle",
    faq: "help-circle",
    warning: "alert-triangle",
    caution: "alert-triangle",
    attention: "alert-triangle",
    failure: "x-circle",
    fail: "x-circle",
    missing: "x-circle",
    danger: "zap",
    error: "zap",
    bug: "bug",
    example: "list",
    quote: "quote",
    cite: "quote",
};

const OPEN_INSERT_MENUS = new Set<NotionBlockInsertMenu>();

export function showNotionBlockInsertMenu(
    plugin: NotionBlock,
    view: EditorView,
    lineNo: number,
    pos: MenuPosition,
    options: InsertMenuOptions = {}
): InsertMenuHandle {
    closeNotionBlockInsertMenus();
    const menu = new NotionBlockInsertMenu(plugin, view, lineNo, pos, options);
    OPEN_INSERT_MENUS.add(menu);
    menu.open();
    return menu;
}

export function closeNotionBlockInsertMenus(): void {
    OPEN_INSERT_MENUS.forEach((menu) => menu.close());
    OPEN_INSERT_MENUS.clear();
}

class NotionBlockInsertMenu implements InsertMenuHandle {
    private readonly plugin: NotionBlock;
    private readonly view: EditorView;
    private readonly lineNo: number;
    private readonly pos: MenuPosition;
    private readonly options: InsertMenuOptions;
    private readonly ownerDocument: Document;
    private readonly ownerWindow: Window;
    private rootEl: HTMLElement | null = null;
    private submenuEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private activeIndex = 0;
    private query = "";
    private visibleItems: InsertItem[] = [];
    private readonly handlePointerDown = (event: PointerEvent): void => this.onPointerDown(event);
    private readonly handleKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);

    constructor(
        plugin: NotionBlock,
        view: EditorView,
        lineNo: number,
        pos: MenuPosition,
        options: InsertMenuOptions
    ) {
        this.plugin = plugin;
        this.view = view;
        this.lineNo = lineNo;
        this.pos = pos;
        this.options = options;
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = this.ownerDocument.defaultView ?? activeWindow;
    }

    open(): void {
        this.rootEl = this.ownerDocument.body.createDiv({ cls: "wk-nb-action-menu wk-nb-insert-menu" });
        this.rootEl.setAttribute("role", "menu");
        this.rootEl.tabIndex = -1;
        this.rootEl.setCssStyles({ left: `${this.pos.x}px`, top: `${this.pos.y}px` });

        this.listEl = this.rootEl.createDiv({ cls: "wk-nb-action-menu-list" });
        this.renderList();
        this.reposition();

        if (this.options.keepEditorFocus) {
            // Clicking a row must not pull focus out of the editor: the caret
            // position is where the insert lands, and a blur would also end the
            // slash session mid-click.
            this.rootEl.addEventListener("mousedown", (event) => event.preventDefault());
        } else {
            this.rootEl.focus();
        }

        this.ownerDocument.addEventListener("pointerdown", this.handlePointerDown, true);
        this.ownerDocument.addEventListener("keydown", this.handleKeyDown, true);
    }

    close(): void {
        this.ownerDocument.removeEventListener("pointerdown", this.handlePointerDown, true);
        this.ownerDocument.removeEventListener("keydown", this.handleKeyDown, true);
        this.closeFloatingSubmenu();
        this.rootEl?.remove();
        this.rootEl = null;
        OPEN_INSERT_MENUS.delete(this);
        this.options.onClose?.();
    }

    setQuery(query: string): boolean {
        if (query === this.query) return this.visibleItems.length > 0;
        this.query = query;
        this.activeIndex = 0;
        this.closeFloatingSubmenu();
        this.renderList();
        return this.visibleItems.length > 0;
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();

        const sections = this.getSections()
            .map((section) => ({
                title: section.title,
                items: section.items.filter((item) => matchesQuery(this.query, item.label, item.keywords)),
            }))
            .filter((section) => section.items.length > 0);

        this.visibleItems = sections.flatMap((section) => section.items);

        sections.forEach((section, index) => {
            if (index > 0) this.renderSeparator();
            this.renderSection(section.title, section.items);
        });

        this.reposition();
    }

    /** The section heading for a run of rows, or "" where the menu shows none. */
    private sectionTitle(key: InsertSectionKey): string {
        if (key === "headings") return t("menu.headings");
        if (key === "insert") return t("menu.insert");
        if (key === "custom") return t("menu.custom");
        // "inline" and "meta" are separated by a rule rather than a heading,
        // which is how they have always rendered.
        return "";
    }

    /** Turns a registry row into a menu row, attaching its behaviour. */
    private toInsertItem(resolved: ResolvedItem): InsertItem {
        // A custom row is the user's own binding: it runs a command and has no
        // submenu and no built-in action.
        if (resolved.commandId) {
            const commandId = resolved.commandId;
            return {
                id: resolved.id,
                label: resolved.label,
                icon: resolved.icon,
                keywords: resolved.keywords,
                action: () => this.runCommand(commandId),
            };
        }

        // The callout row opens a submenu instead of inserting, and its icon
        // tracks the default callout type rather than the table's placeholder.
        if (resolved.id === "callout") {
            return {
                id: resolved.id,
                label: resolved.label,
                icon: this.getCalloutIcon("note"),
                keywords: resolved.keywords,
                page: "callout",
            };
        }

        return {
            id: resolved.id,
            label: resolved.label,
            icon: resolved.icon,
            keywords: resolved.keywords,
            action: this.builtinAction(resolved.id),
        };
    }

    private builtinAction(id: string): InsertAction {
        if (id === "toc") return () => this.insertTableOfContents();
        if (id === "page") return () => this.createPage();
        if (id === "image") return () => this.openImagePicker();
        if (id === "attachment") return () => this.openAttachmentPicker();
        return () => this.insert(id);
    }

    private getSections(): InsertSection[] {
        // While filtering, the callout types are listed flat instead of behind
        // a submenu row. Typing "bug" should insert a bug callout, not offer a
        // "Callout" row that has to be opened with the mouse — the whole point
        // of typing is to avoid reaching for it. They stay collapsed when there
        // is no query so the resting menu is not twelve rows longer.
        const isFiltering = this.query.trim().length > 0;
        const settings = this.plugin.settings;

        const resolved = resolveMenuItems(
            BUILTIN_ITEMS,
            settings.insertCustom,
            settings.insertOrder,
            // The submenu parent is redundant while filtering, because the flat
            // callout rows below carry every type it would have opened.
            isFiltering ? [...settings.insertHidden, "callout"] : settings.insertHidden,
            t
        );

        const sections: InsertSection[] = groupBySection(resolved).map((section) => ({
            title: this.sectionTitle(section.sectionKey),
            items: section.items.map((item) => this.toInsertItem(item)),
        }));

        sections.push(
            { title: isFiltering ? t("menu.callout") : "", items: isFiltering ? this.getCalloutItems() : [] },
            { title: "", items: this.getDismissItems() }
        );

        return sections;
    }

    /**
     * Runs a user-bound Obsidian command.
     *
     * The menu closes and the typed `/query` is removed first, so the command
     * acts on a document with no trigger text left in it. The removal and the
     * command are two undo steps rather than one: the command dispatches its
     * own transaction and there is no way to reach inside it. Undoing twice
     * after a custom row is the accepted cost of binding arbitrary commands.
     *
     * app.commands is not in Obsidian's public types, hence the narrow cast.
     */
    private runCommand(commandId: string): boolean {
        const remove = this.removeRange();
        this.close();

        if (remove) {
            this.view.dispatch({ changes: { from: remove.from, to: remove.to, insert: "" } });
        }

        const commands = (this.plugin.app as unknown as {
            commands?: { executeCommandById(id: string): boolean };
        }).commands;
        commands?.executeCommandById(commandId);

        // Already closed above; returning true stops activateItem closing twice.
        return true;
    }

    /**
     * "Close menu" — leaves the typed trigger in the note as literal text.
     *
     * Escape already does this, but only if you know it does. Offered only
     * when a trigger character was actually typed: opened from the "+" handle
     * there is no "/" sitting in the document to keep, so the row would close
     * a menu and do nothing else.
     */
    private getDismissItems(): InsertItem[] {
        if (this.options.replaceFrom === undefined) return [];
        return [{
            id: "close",
            label: t("menu.closeMenu"),
            icon: "x",
            keywords: ["escape", "esc", "dismiss", "cancel", "text", "literal"],
            // Neither inserts nor removes: everything typed stays exactly
            // where it is, which is the whole point of the row.
            action: () => undefined,
        }];
    }

    private renderSection(title: string, items: InsertItem[]): void {
        if (!this.listEl || items.length === 0) return;
        if (title) {
            this.listEl.createDiv({ cls: "wk-nb-action-menu-section", text: title });
        }
        items.forEach((item) => this.renderItem(item));
    }

    private renderSeparator(): void {
        this.listEl?.createDiv({ cls: "wk-nb-action-menu-separator" });
    }

    private renderItem(item: InsertItem): void {
        if (!this.listEl) return;
        const index = this.visibleItems.indexOf(item);
        const row = this.listEl.createDiv({
            cls: `wk-nb-action-menu-row${index === this.activeIndex ? " is-active" : ""}`,
            attr: { role: "menuitem" }
        });
        setIcon(row.createSpan({ cls: "wk-nb-action-menu-icon" }), item.icon);
        row.createSpan({ cls: "wk-nb-action-menu-label", text: item.label });
        if (item.page) {
            setIcon(row.createSpan({ cls: "wk-nb-action-menu-chevron" }), "chevron-right");
        }

        row.addEventListener("mouseenter", () => {
            this.activeIndex = Math.max(0, index);
            this.refreshActiveRows();
            this.syncFloatingSubmenuForItem(item);
        });
        row.addEventListener("click", () => {
            this.activateItem(item);
        });
    }

    private renderFloatingSubmenu(page: InsertPage): void {
        if (!this.rootEl) return;
        this.submenuEl?.remove();
        this.submenuEl = this.ownerDocument.body.createDiv({ cls: `wk-nb-action-menu wk-nb-action-submenu is-${page}` });
        this.submenuEl.setAttribute("role", "menu");
        if (this.options.keepEditorFocus) {
            this.submenuEl.addEventListener("mousedown", (event) => event.preventDefault());
        }
        this.renderFloatingSection(this.submenuEl, t("menu.callout"), this.getCalloutItems(false));
        this.positionFloatingSubmenu();
    }

    private getCalloutItems(prefixed = true): InsertItem[] {
        return CALLOUT_OPTIONS.map((option): InsertItem => ({
            id: `callout-${option.type}`,
            // In the flat list both words are in the label so the query can
            // arrive from either direction: "callout" lists them all, "bug"
            // finds the one. Inside the submenu the heading already says
            // "Callout", so repeating it on every row is just noise.
            label: prefixed
                ? `${t("menu.callout")}: ${t(`callout.${option.type}`)}`
                : t(`callout.${option.type}`),
            icon: this.getCalloutIcon(option.type),
            keywords: [option.type, "admonition"],
            action: () => this.insert(`callout-${option.type}`)
        }));
    }


    private renderFloatingSection(container: HTMLElement, title: string, items: InsertItem[]): void {
        container.createDiv({ cls: "wk-nb-action-menu-section", text: title });
        items.forEach((item) => {
            const row = container.createDiv({ cls: "wk-nb-action-menu-row", attr: { role: "menuitem" } });
            setIcon(row.createSpan({ cls: "wk-nb-action-menu-icon" }), item.icon);
            row.createSpan({ cls: "wk-nb-action-menu-label", text: item.label });
            row.addEventListener("click", () => {
                this.activateItem(item);
            });
        });
    }

    private closeFloatingSubmenu(): void {
        this.submenuEl?.remove();
        this.submenuEl = null;
    }

    private syncFloatingSubmenuForItem(item: InsertItem | undefined): void {
        if (item?.page) {
            this.renderFloatingSubmenu(item.page);
            return;
        }
        this.closeFloatingSubmenu();
    }

    private refreshActiveRows(): void {
        if (!this.listEl) return;
        const rows = Array.from(this.listEl.querySelectorAll(".wk-nb-action-menu-row"));
        rows.forEach((row, index) => {
            row.toggleClass("is-active", index === this.activeIndex);
        });
        // The list scrolls once the menu is capped, so arrowing past the
        // bottom has to bring the row along or the highlight vanishes.
        rows[this.activeIndex]?.scrollIntoView({ block: "nearest" });
    }

    private activateItem(item: InsertItem): void {
        if (item.page) {
            this.renderFloatingSubmenu(item.page);
            return;
        }
        const keepOpen = item.action?.();
        if (keepOpen !== true) this.close();
    }

    /**
     * The `/query` to delete alongside the insert.
     *
     * Read at activation time rather than when the menu opened, because the
     * user carries on typing while it is up and the caret has moved since.
     */
    private removeRange(): RemoveRange | undefined {
        const from = this.options.replaceFrom;
        if (from === undefined) return undefined;
        const to = this.view.state.selection.main.head;
        if (to <= from) return undefined;
        return { from, to };
    }

    private insert(type: string): void {
        insertBlock(this.plugin, this.view, this.lineNo, type, this.removeRange());
    }

    private insertTableOfContents(): void {
        insertTableOfContents(this.view, this.lineNo, this.removeRange());
    }

    /**
     * The query range is read here, synchronously, and passed in.
     *
     * Creating the note is async, so the menu has already closed by the time
     * the link is written — reading the range inside insertNewPage would read
     * it from a menu that no longer exists.
     */
    private createPage(): void {
        void insertNewPage(this.plugin, this.view, this.lineNo, this.removeRange());
    }

    private openImagePicker(): boolean {
        return this.openFilePicker(
            ".avif,.bmp,.gif,.jpeg,.jpg,.png,.svg,.webp,image/avif,image/bmp,image/gif,image/jpeg,image/png,image/svg+xml,image/webp",
            (files, remove) => insertImageFiles(this.plugin, this.view, this.lineNo, files, remove)
        );
    }

    private openAttachmentPicker(): boolean {
        return this.openFilePicker(
            "",
            (files, remove) => insertAttachmentFiles(this.plugin, this.view, this.lineNo, files, remove)
        );
    }

    private openFilePicker(
        accept: string,
        handle: (files: File[], remove?: RemoveRange) => Promise<void>
    ): boolean {
        // Captured before the dialog opens. Opening a file dialog can move the
        // caret (the editor loses focus), and the range has to describe the
        // document as it was when the menu was still tracking it.
        const remove = this.removeRange();

        const input = this.ownerDocument.body.createEl("input", {
            attr: {
                type: "file",
                multiple: "true",
                ...(accept ? { accept } : {}),
            }
        });
        input.addClass("wk-nb-hidden-file-input");

        const cleanup = (): void => {
            input.remove();
            this.close();
        };

        input.addEventListener("change", () => {
            const files = Array.from(input.files ?? []);
            void handle(files, remove).finally(cleanup);
        }, { once: true });
        input.addEventListener("cancel", cleanup, { once: true });
        input.click();
        return true;
    }

    private getCalloutIcon(type: string | undefined): string {
        if (!type) return CALLOUT_ICONS.note;
        return CALLOUT_ICONS[type.toLowerCase()] ?? CALLOUT_ICONS.note;
    }

    private onPointerDown(event: PointerEvent): void {
        if (this.rootEl?.contains(event.target as Node)) return;
        if (this.submenuEl?.contains(event.target as Node)) return;
        this.close();
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (!this.rootEl) return;

        // Keys the menu takes are stopped outright, not merely prevented. With
        // the slash menu the editor still has focus, so a bare preventDefault
        // would leave CodeMirror free to move the caret on Arrow keys and
        // insert a newline on Enter underneath the menu.
        const consume = (): void => {
            event.preventDefault();
            event.stopPropagation();
        };

        if (event.key === "Escape") {
            consume();
            this.close();
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            consume();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            const length = Math.max(this.visibleItems.length, 1);
            this.activeIndex = (this.activeIndex + delta + length) % length;
            this.refreshActiveRows();
            this.syncFloatingSubmenuForItem(this.visibleItems[this.activeIndex]);
            return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
            const item = this.visibleItems[this.activeIndex];
            if (!item) return;
            consume();
            this.activateItem(item);
        }
    }

    /**
     * Places the menu below the anchor, or above it when it will not fit.
     *
     * Never between the two. The old behaviour was to slide the menu up until
     * it fit on screen, which put it straight over the line being typed — the
     * query kept filtering, but the user could not see what they were typing.
     * Flipping keeps the caret visible, and the height is capped to whichever
     * side was chosen so the list scrolls rather than overflowing back over it.
     */
    private reposition(): void {
        if (!this.rootEl) return;

        // Measured at natural height first: which side the menu goes on depends
        // on how tall it wants to be, not on the cap left over from last time.
        this.rootEl.setCssStyles({ maxHeight: "" });
        const rect = this.rootEl.getBoundingClientRect();

        const placement = placeMenu({
            anchorX: this.pos.x,
            anchorY: this.pos.y,
            avoidTop: this.options.avoid?.top ?? this.pos.y,
            menuWidth: rect.width,
            menuHeight: rect.height,
            viewportWidth: this.ownerWindow.innerWidth,
            viewportHeight: this.ownerWindow.innerHeight,
        });

        this.rootEl.setCssStyles({
            maxHeight: `${placement.maxHeight}px`,
            left: `${placement.left}px`,
            top: `${placement.top}px`,
        });
        this.positionFloatingSubmenu();
    }

    private positionFloatingSubmenu(): void {
        if (!this.rootEl || !this.submenuEl) return;
        const rootRect = this.rootEl.getBoundingClientRect();
        const submenuRect = this.submenuEl.getBoundingClientRect();

        const placement = placeSubmenu({
            parentLeft: rootRect.left,
            parentRight: rootRect.right,
            parentTop: rootRect.top,
            menuWidth: submenuRect.width,
            menuHeight: submenuRect.height,
            viewportWidth: this.ownerWindow.innerWidth,
            viewportHeight: this.ownerWindow.innerHeight,
        });

        this.submenuEl.setCssStyles({ left: `${placement.left}px`, top: `${placement.top}px` });
    }
}
