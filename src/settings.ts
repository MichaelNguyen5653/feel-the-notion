import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import NotionBlock from './main';
import { t } from './locale/helpers';
import { BUILTIN_ITEMS, CustomInsertItem, resolveMenuItems } from './insertRegistry';
import { InsertCommandModal } from './insertCommandModal';

export interface BlockPluginSettings {
    enabled: boolean;
    dragGranularity: 'line' | 'paragraph';
    hoverDelay: number;
    hideDelay: number;
    /** Which edge of the content the hover handle is drawn beside. */
    handleSide: 'left' | 'right';
    /** Pin the handle to the caret's block so it never hides on pointer-out. */
    handleAlwaysVisible: boolean;
    /** Show the fold chevron on the hover handle. */
    foldHandle: boolean;
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
    /** Insert-menu item ids in the order the user chose. Empty means the default order. */
    insertOrder: string[];
    /** Insert-menu item ids the user turned off. */
    insertHidden: string[];
    /** Insert-menu rows the user added, each bound to an Obsidian command. */
    insertCustom: CustomInsertItem[];
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
    // Raised from 200ms. It has to cover the pointer's pause between leaving
    // a line and arriving at the handle, which is what made the handle feel
    // like it vanished the moment attention moved to it.
    hideDelay: 300,
    handleSide: 'left',
    // OFF by default: it changes the handle from a hover affordance into a
    // permanent one, which is a different editor to look at.
    handleAlwaysVisible: false,
    foldHandle: true,
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
    // Empty rather than the built-in order: resolveMenuItems appends anything
    // an order does not name, so an empty order IS the built-in order, and
    // storing it explicitly would freeze out rows added by later versions.
    insertOrder: [],
    insertHidden: [],
    insertCustom: [],
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
            .setName(t('settings.handleSide.name'))
            .setDesc(t('settings.handleSide.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('left', t('settings.handleSide.left'))
                .addOption('right', t('settings.handleSide.right'))
                .setValue(this.plugin.settings.handleSide)
                .onChange(async (value: 'left' | 'right') => {
                    this.plugin.settings.handleSide = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.handleAlwaysVisible.name'))
            .setDesc(t('settings.handleAlwaysVisible.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.handleAlwaysVisible)
                .onChange(async (value) => {
                    this.plugin.settings.handleAlwaysVisible = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.foldHandle.name'))
            .setDesc(t('settings.foldHandle.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.foldHandle)
                .onChange(async (value) => {
                    this.plugin.settings.foldHandle = value;
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

        new Setting(containerEl)
            .setName(t('settings.insertItems.name'))
            .setDesc(t('settings.insertItems.desc'))
            .setHeading();

        this.renderInsertItemList(containerEl);
    }

    /**
     * The insert menu's rows, reorderable and individually switchable.
     *
     * Order is stored as a full id list rather than as a sparse set of moves:
     * resolveMenuItems appends anything the list does not name, so a partial
     * list still works, but writing the whole list keeps what is stored and
     * what is shown identical.
     */
    private renderInsertItemList(containerEl: HTMLElement): void {
        const settings = this.plugin.settings;
        const listEl = containerEl.createDiv({ cls: 'ftn-insert-item-list' });

        // Hidden items must appear in this list or they could never be turned
        // back on, so it is resolved with an empty hidden set.
        const items = resolveMenuItems(BUILTIN_ITEMS, settings.insertCustom, settings.insertOrder, [], (key) => t(key));
        const order = items.map((item) => item.id);

        const persist = async (nextOrder: string[]) => {
            settings.insertOrder = nextOrder;
            await this.plugin.saveSettings();
            this.display();
        };

        items.forEach((item, index) => {
            const row = listEl.createDiv({ cls: 'ftn-insert-item-row', attr: { draggable: 'true' } });
            row.dataset.index = String(index);

            setIcon(row.createSpan({ cls: 'ftn-insert-item-grip' }), 'grip-vertical');
            setIcon(row.createSpan({ cls: 'ftn-insert-item-icon' }), item.icon);
            row.createSpan({ cls: 'ftn-insert-item-label', text: item.label });

            const custom = settings.insertCustom.find((entry) => entry.id === item.id);
            if (custom) {
                // A binding whose command has gone (plugin disabled or removed)
                // stays in the list and says so, rather than disappearing and
                // taking the user's configuration with it.
                const commands = (this.app as unknown as {
                    commands?: { commands?: Record<string, unknown> };
                }).commands?.commands;
                if (commands && !(custom.commandId in commands)) {
                    row.createSpan({ cls: 'ftn-insert-item-warning', text: t('settings.commandMissing') });
                }
            }

            const controls = row.createDiv({ cls: 'ftn-insert-item-controls' });

            const toggle = controls.createEl('input', { attr: { type: 'checkbox' } });
            toggle.checked = !settings.insertHidden.includes(item.id);
            toggle.addEventListener('change', async () => {
                settings.insertHidden = toggle.checked
                    ? settings.insertHidden.filter((id) => id !== item.id)
                    : [...settings.insertHidden, item.id];
                await this.plugin.saveSettings();
            });

            if (custom) {
                const editBtn = controls.createDiv({ cls: 'ftn-insert-item-button', attr: { 'aria-label': t('settings.customCommand.edit') } });
                setIcon(editBtn, 'pencil');
                editBtn.addEventListener('click', () => {
                    new InsertCommandModal(this.app, custom, async (updated) => {
                        settings.insertCustom = settings.insertCustom.map((entry) =>
                            entry.id === updated.id ? updated : entry);
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                });

                const deleteBtn = controls.createDiv({ cls: 'ftn-insert-item-button is-danger', attr: { 'aria-label': t('settings.customCommand.delete') } });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.addEventListener('click', async () => {
                    settings.insertCustom = settings.insertCustom.filter((entry) => entry.id !== custom.id);
                    settings.insertOrder = order.filter((id) => id !== custom.id);
                    settings.insertHidden = settings.insertHidden.filter((id) => id !== custom.id);
                    await this.plugin.saveSettings();
                    this.display();
                });
            }

            row.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/plain', String(index));
                row.addClass('is-dragging');
            });
            row.addEventListener('dragend', () => row.removeClass('is-dragging'));
            row.addEventListener('dragover', (event) => {
                event.preventDefault();
                row.addClass('is-drop-target');
            });
            row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
            row.addEventListener('drop', async (event) => {
                event.preventDefault();
                row.removeClass('is-drop-target');
                const from = Number(event.dataTransfer?.getData('text/plain'));
                if (!Number.isInteger(from) || from === index) return;
                const next = [...order];
                const [moved] = next.splice(from, 1);
                // `index` was measured against the pre-removal array, so once the dragged
                // row is spliced out everything after it has shifted up by one. Without
                // this correction a downward drag lands the row after its target while an
                // upward drag lands before it, and the outline means the same thing both
                // times.
                next.splice(index - (from < index ? 1 : 0), 0, moved);
                await persist(next);
            });
        });

        new Setting(containerEl)
            .addButton((button) => button
                .setButtonText(t('settings.addCommand'))
                .onClick(() => {
                    new InsertCommandModal(this.app, null, async (item: CustomInsertItem) => {
                        settings.insertCustom = [...settings.insertCustom, item];
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                }))
            .addButton((button) => button
                .setButtonText(t('settings.resetOrder'))
                .onClick(async () => {
                    settings.insertOrder = [];
                    settings.insertHidden = [];
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }
}

