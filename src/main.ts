import { Editor, Plugin } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { BlockPluginSettings, DEFAULT_SETTINGS, BlockPluginSettingTab } from './settings';
import { blockHandlesExtension } from './blockHandles';
import { hideSyntaxExtension } from './hideSyntax';
import { blockSelectionExtension } from './blockSelection';
import { blockKeymapExtension } from './blockKeymap';
import { slashMenuExtension } from './slashMenu';
import { blockFoldExtension } from './blockFold';
import { showNotionBlockInsertMenu } from './notionInsertMenu';
import { t } from './locale/helpers';
import { bulletDepthExtension, resolveBulletMarkers } from './bulletDepth';
import { RELEASE_NOTES, shouldShowWhatsNew } from './whatsNew';
import { WhatsNewModal } from './whatsNewModal';

export default class NotionBlock extends Plugin {
    settings: BlockPluginSettings;

    async onload() {
        const hadSavedData = await this.loadSettings();

        // Register the CodeMirror 6 extension for hover handles
        this.registerEditorExtension([
            blockHandlesExtension(this),
            hideSyntaxExtension(this),
            blockSelectionExtension(this),
            blockKeymapExtension(this),
            slashMenuExtension(this),
            blockFoldExtension(),
            bulletDepthExtension(() => this.bulletMarkers()),
        ]);
        this.syncBulletClass();

        // The same menu the "+" handle and the trigger character open, exposed
        // as a command so it can be given a real hotkey under Settings →
        // Hotkeys rather than only a typed character.
        this.addCommand({
            id: 'open-insert-menu',
            name: t('command.openInsertMenu'),
            editorCallback: (editor: Editor) => this.openInsertMenuAtCursor(editor),
        });

        this.addCommand({
            id: 'show-whats-new',
            name: "Show what's new",
            callback: () => this.openWhatsNew(),
        });

        // Add settings tab
        this.addSettingTab(new BlockPluginSettingTab(this.app, this));

        // After layout, so the card opens over a ready workspace rather than
        // racing the editor being restored underneath it.
        this.app.workspace.onLayoutReady(() => this.maybeShowWhatsNew(hadSavedData));
    }

    onunload() {
        document.body.removeClass('ftn-bullet-depth');
    }

    /** The marker sequence while bullet depth markers are on, null while off. */
    bulletMarkers(): readonly string[] | null {
        const s = this.settings;
        if (!s.enabled || !s.bulletDepth) return null;
        return resolveBulletMarkers(s.bulletOrder, s.bulletHidden);
    }

    /**
     * The ● ○ ▪ styling is plain CSS, so it is switched by a body class rather
     * than by registering anything: off, the stylesheet matches nothing.
     */
    private syncBulletClass(): void {
        // chisle: main window only. A popout window keeps Obsidian's own
        // bullets, though its file markers are still rewritten.
        document.body.toggleClass('ftn-bullet-depth', this.bulletMarkers() !== null);
    }

    private maybeShowWhatsNew(hadSavedData: boolean): void {
        const current = this.manifest.version;
        if (shouldShowWhatsNew(hadSavedData, this.settings.lastSeenVersion, current, RELEASE_NOTES.version)) {
            this.openWhatsNew();
            return;
        }
        // A fresh install, or a release without notes of its own: record it,
        // so the next update is measured from here and the card shows then.
        if (this.settings.lastSeenVersion !== current) void this.markWhatsNewSeen();
    }

    private openWhatsNew(): void {
        new WhatsNewModal(this.app, RELEASE_NOTES, () => void this.markWhatsNewSeen()).open();
    }

    private async markWhatsNewSeen(): Promise<void> {
        this.settings.lastSeenVersion = this.manifest.version;
        await this.saveData(this.settings);
    }

    private openInsertMenuAtCursor(editor: Editor): void {
        const view = (editor as unknown as { cm?: EditorView }).cm;
        if (!view) return;

        const head = view.state.selection.main.head;
        const coords = view.coordsAtPos(head);
        if (!coords) return;

        showNotionBlockInsertMenu(
            this,
            view,
            view.state.doc.lineAt(head).number,
            { x: coords.left, y: coords.bottom + 6 },
            { avoid: { top: coords.top, bottom: coords.bottom }, keepEditorFocus: true }
        );
    }

    /** Returns whether saved settings existed, which is how an update is told from a fresh install. */
    async loadSettings(): Promise<boolean> {
        const data = await this.loadData() as Partial<BlockPluginSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        return data !== null;
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.syncBulletClass();
        // Notify editor extensions that settings have changed
        this.app.workspace.updateOptions();
    }
}
