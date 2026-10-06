import { App, Modal, Setting } from 'obsidian';
import { ReleaseNotes } from './whatsNew';

/**
 * The card that opens once after an update.
 *
 * Any close counts as dismissing it, the Escape key and the corner × included,
 * not only the button. A card that reappeared because it was closed the
 * "wrong" way would be the thing people disable the plugin over.
 */
export class WhatsNewModal extends Modal {
    constructor(app: App, private notes: ReleaseNotes, private onDismiss: () => void) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass('ftn-whats-new');
        this.titleEl.setText(`What's new in Feel the Notion ${this.notes.version}`);

        const list = this.contentEl.createEl('ul');
        for (const item of this.notes.items) list.createEl('li', { text: item });

        new Setting(this.contentEl).addButton((button) => button
            .setButtonText('Dismiss')
            .setCta()
            .onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
        this.onDismiss();
    }
}
