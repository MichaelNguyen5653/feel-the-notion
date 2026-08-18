import { App, PluginSettingTab, Setting } from 'obsidian';
import NotionBlock from './main';
import { t } from './locale/helpers';

export interface BlockPluginSettings {
    enabled: boolean;
    dragGranularity: 'line' | 'paragraph';
    hoverDelay: number;
    hideDelay: number;
    dateFormat: string;
    timeFormat: string;
    /** Hide markdown syntax markers on the active line too, killing reflow. */
    hideSyntaxMarkers: boolean;
    /** Expand a multi-block drag selection to whole blocks, as Notion does. */
    snapSelectionToBlocks: boolean;
    /** Cmd+A escalation and Backspace-at-block-start. */
    blockKeys: boolean;
    /** Show the "+" button on the hover handle. */
    plusHandle: boolean;
    /** Open the insert menu by typing a trigger character on an empty block. */
    slashMenu: boolean;
    /** The character that opens it. */
    slashTrigger: string;
    /** Also open it mid-line, after a space, rather than on empty blocks only. */
    slashInline: boolean;
    /** Write inserted attachments as embeds (a leading "!") rather than links. */
    embedAttachments: boolean;
}

export const DEFAULT_SETTINGS: BlockPluginSettings = {
    enabled: true,
    // Notion drags whole blocks, not single lines. A wrapped paragraph is one
    // block to the reader, so 'line' meant grabbing a paragraph moved a
    // fragment of it and left the rest behind.
    dragGranularity: 'paragraph',
    hoverDelay: 0,
    hideDelay: 200,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    // OFF by default: it changes editing behaviour, not just appearance.
    // With it on, `**` cannot be clicked between or hand-edited.
    hideSyntaxMarkers: false,
    // OFF by default: it changes what Backspace and typing replace, so it is
    // behaviour rather than appearance. The blue overlay is on regardless.
    snapSelectionToBlocks: false,
    blockKeys: true,
    plusHandle: true,
    slashMenu: true,
    slashTrigger: '/',
    slashInline: true,
    // OFF by default, as asked: an attachment reads as a link unless it is
    // explicitly meant to render inline.
    embedAttachments: false,
};

export class BlockPluginSettingTab extends PluginSettingTab {
    plugin: NotionBlock;

    constructor(app: App, plugin: NotionBlock) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName(t('settings.enablePlugin.name'))
            .setDesc(t('settings.enablePlugin.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.enabled = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.dragGranularity.name'))
            .setDesc(t('settings.dragGranularity.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('line', t('settings.dragGranularity.line'))
                .addOption('paragraph', t('settings.dragGranularity.paragraph'))
                .setValue(this.plugin.settings.dragGranularity)
                .onChange(async (value: 'line' | 'paragraph') => {
                    this.plugin.settings.dragGranularity = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.hoverDelay.name'))
            .setDesc(t('settings.hoverDelay.desc'))
            .addSlider(slider => slider
                .setLimits(0, 500, 50)
                .setValue(this.plugin.settings.hoverDelay)
                .onChange(async (value) => {
                    this.plugin.settings.hoverDelay = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.hideDelay.name'))
            .setDesc(t('settings.hideDelay.desc'))
            .addSlider(slider => slider
                .setLimits(0, 1000, 50)
                .setValue(this.plugin.settings.hideDelay)
                .onChange(async (value) => {
                    this.plugin.settings.hideDelay = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.dateFormat.name'))
            .setDesc(t('settings.dateFormat.desc'))
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.timeFormat.name'))
            .setDesc(t('settings.timeFormat.desc'))
            .addText(text => text
                .setPlaceholder('HH:mm')
                .setValue(this.plugin.settings.timeFormat)
                .onChange(async (value) => {
                    this.plugin.settings.timeFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Hide syntax markers')
            .setDesc(
                'Keep **, _, ==, ` and heading #s hidden even on the line you are editing, '
                + 'so text stops shifting sideways as the caret enters a formatted span. '
                + 'Trade-off: markers cannot be clicked between or hand-edited \u2014 use Cmd+B / Cmd+I instead.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideSyntaxMarkers)
                .onChange(async (value) => {
                    this.plugin.settings.hideSyntaxMarkers = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Snap selection to whole blocks')
            .setDesc(
                'When a mouse drag crosses a block boundary, expand the selection to whole blocks. '
                + 'The blue block overlay is shown either way; this controls whether typing and '
                + 'Backspace act on whole blocks too. Shift+Arrow is never snapped.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.snapSelectionToBlocks)
                .onChange(async (value) => {
                    this.plugin.settings.snapSelectionToBlocks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Block-aware Cmd+A and Backspace')
            .setDesc(
                'Cmd+A selects the block you are in, and again selects the note. '
                + 'Backspace at the start of a block steps out one indent level, then drops the '
                + 'list marker or heading, then merges into the block above.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.blockKeys)
                .onChange(async (value) => {
                    this.plugin.settings.blockKeys = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Insert menu').setHeading();

        new Setting(containerEl)
            .setName('Show the "+" handle')
            .setDesc('The button beside the drag handle that opens the insert menu.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.plusHandle)
                .onChange(async (value) => {
                    this.plugin.settings.plusHandle = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Open the insert menu by typing')
            .setDesc(
                'Type the trigger character to open the same menu the "+" handle opens, '
                + 'then keep typing to filter it.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.slashMenu)
                .onChange(async (value) => {
                    this.plugin.settings.slashMenu = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Trigger character')
            .setDesc('A single character. For a key combination instead, bind "Open block insert menu" under Hotkeys.')
            .addText(text => text
                .setPlaceholder('/')
                .setValue(this.plugin.settings.slashTrigger)
                .onChange(async (value) => {
                    this.plugin.settings.slashTrigger = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Open it mid-line too')
            .setDesc(
                'Off: the trigger only works on an otherwise empty block. '
                + 'On: it also works in the middle of a line, as long as it follows a space \u2014 '
                + 'so "and/or", a URL and a date are still left alone.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.slashInline)
                .onChange(async (value) => {
                    this.plugin.settings.slashInline = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Embed inserted attachments')
            .setDesc(
                'Off: an attachment is inserted as a link, [name](path). '
                + 'On: it gets a leading "!" so Obsidian renders it inline. '
                + 'Either way the file is saved wherever Files & Links says attachments go.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.embedAttachments)
                .onChange(async (value) => {
                    this.plugin.settings.embedAttachments = value;
                    await this.plugin.saveSettings();
                }));
    }
}

