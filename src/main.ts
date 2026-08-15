import { Editor, Plugin } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { BlockPluginSettings, DEFAULT_SETTINGS, BlockPluginSettingTab } from './settings';
import { blockHandlesExtension } from './blockHandles';
import { hideSyntaxExtension } from './hideSyntax';
import { blockSelectionExtension } from './blockSelection';
import { blockKeymapExtension } from './blockKeymap';
import { slashMenuExtension } from './slashMenu';
import { showNotionBlockInsertMenu } from './notionInsertMenu';
import { t } from './locale/helpers';

export default class NotionBlock extends Plugin {
    settings: BlockPluginSettings;

    async onload() {
        await this.loadSettings();

        // Register the CodeMirror 6 extension for hover handles
        this.registerEditorExtension([
            blockHandlesExtension(this),
            hideSyntaxExtension(this),
            blockSelectionExtension(this),
            blockKeymapExtension(this),
            slashMenuExtension(this),
        ]);

        // The same menu the "+" handle and the trigger character open, exposed
        // as a command so it can be given a real hotkey under Settings →
        // Hotkeys rather than only a typed character.
        this.addCommand({
            id: 'open-insert-menu',
            name: t('command.openInsertMenu'),
            editorCallback: (editor: Editor) => this.openInsertMenuAtCursor(editor),
        });

        // Add settings tab
        this.addSettingTab(new BlockPluginSettingTab(this.app, this));

    }

    onunload() {
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

    async loadSettings() {
        const data = await this.loadData() as Partial<BlockPluginSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Notify editor extensions that settings have changed
        this.app.workspace.updateOptions();
    }
}
