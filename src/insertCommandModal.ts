import { AbstractInputSuggest, App, Command, Modal, Setting, setIcon } from "obsidian";
import { CustomInsertItem } from "./insertRegistry";
import { t } from "./locale/helpers";

/** Every command Obsidian currently knows about. Not in the public types. */
function listCommands(app: App): Command[] {
	const commands = (app as unknown as {
		commands?: { listCommands(): Command[] };
	}).commands;
	return commands?.listCommands() ?? [];
}

/** Type-ahead over command names, so the user never has to know an id. */
class CommandSuggest extends AbstractInputSuggest<Command> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onPick: (command: Command) => void
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): Command[] {
		const needle = query.toLowerCase();
		return listCommands(this.app)
			.filter((command) => command.name.toLowerCase().includes(needle))
			.slice(0, 50);
	}

	renderSuggestion(command: Command, el: HTMLElement): void {
		el.setText(command.name);
	}

	selectSuggestion(command: Command): void {
		this.setValue(command.name);
		this.onPick(command);
		this.close();
	}
}

/**
 * Adds or edits one custom insert-menu row.
 *
 * The command is chosen by name and the id is stored, because ids are opaque
 * and names are what the user recognises. The icon is a Lucide name with a
 * live preview beside it rather than a picker grid: the preview is what tells
 * the user whether they got the name right, which is the only thing a grid
 * would have added.
 */
export class InsertCommandModal extends Modal {
	private label: string;
	private icon: string;
	private commandId: string;
	private readonly id: string;
	private iconPreviewEl: HTMLElement | null = null;

	constructor(
		app: App,
		existing: CustomInsertItem | null,
		private readonly onSave: (item: CustomInsertItem) => void
	) {
		super(app);
		this.id = existing?.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		this.label = existing?.label ?? "";
		this.icon = existing?.icon ?? "zap";
		this.commandId = existing?.commandId ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: t("settings.customCommand.title") });

		new Setting(contentEl)
			.setName(t("settings.customCommand.label"))
			.addText((text) => text
				.setValue(this.label)
				.onChange((value) => {
					this.label = value;
				}));

		const commandName = listCommands(this.app)
			.find((command) => command.id === this.commandId)?.name ?? "";

		new Setting(contentEl)
			.setName(t("settings.customCommand.command"))
			.setDesc(t("settings.customCommand.commandDesc"))
			.addText((text) => {
				text.setValue(commandName);
				new CommandSuggest(this.app, text.inputEl, (command) => {
					this.commandId = command.id;
					// A command with its own icon is almost always better than
					// the placeholder, and the user can still overwrite it.
					if (command.icon && this.icon === "zap") {
						this.icon = command.icon;
						this.renderIconPreview();
					}
				});
			});

		const iconSetting = new Setting(contentEl)
			.setName(t("settings.customCommand.icon"))
			.setDesc(t("settings.customCommand.iconDesc"))
			.addText((text) => text
				.setValue(this.icon)
				.onChange((value) => {
					this.icon = value;
					this.renderIconPreview();
				}));
		this.iconPreviewEl = iconSetting.controlEl.createSpan({ cls: "ftn-icon-preview" });
		this.renderIconPreview();

		new Setting(contentEl)
			.addButton((button) => button
				.setButtonText(t("settings.customCommand.save"))
				.setCta()
				.onClick(() => {
					// Both are required: a row with no command does nothing, and
					// a row with no label is a blank line in the menu.
					if (!this.label.trim() || !this.commandId) return;
					this.onSave({
						id: this.id,
						label: this.label.trim(),
						icon: this.icon.trim() || "zap",
						commandId: this.commandId,
					});
					this.close();
				}))
			.addButton((button) => button
				.setButtonText(t("settings.customCommand.cancel"))
				.onClick(() => this.close()));
	}

	private renderIconPreview(): void {
		if (!this.iconPreviewEl) return;
		this.iconPreviewEl.empty();
		setIcon(this.iconPreviewEl, this.icon.trim() || "zap");
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
