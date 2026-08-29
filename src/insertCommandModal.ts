import { AbstractInputSuggest, App, Command, Modal, Setting, setIcon } from "obsidian";
import { COMMAND_PICKER_LIMIT, CustomInsertItem, matchCommands } from "./insertRegistry";
import { t } from "./locale/helpers";

/**
 * Every registered command, from Obsidian core and from every plugin.
 *
 * WHY NOT app.commands.listCommands()
 * Obsidian defines it as
 *   Object.values(this.commands).filter(c => !c.checkCallback || c.checkCallback(true))
 * and addCommand() synthesises a checkCallback for every command registered
 * with editorCallback or editorCheckCallback, one that returns null when
 * workspace.activeEditor is falsy and bails out when the note is in preview.
 *
 * So listCommands() answers "what could run right now", and while a settings
 * modal is up that answer drops most editor commands, which is nearly
 * everything worth binding. Binding is configuration for later, not execution
 * now, so the picker reads the whole registry instead.
 */
function listCommands(app: App): Command[] {
	const registry = (app as unknown as {
		commands?: { commands?: Record<string, Command> };
	}).commands?.commands;
	return registry ? Object.values(registry) : [];
}

/** Type-ahead over command names, so the user never has to know an id. */
class CommandSuggest extends AbstractInputSuggest<Command> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onPick: (command: Command) => void
	) {
		super(app, inputEl);
		// AbstractInputSuggest renders 100 by default; matchCommands has already
		// ranked and capped, so let it show what it was given.
		this.limit = COMMAND_PICKER_LIMIT;
	}

	protected getSuggestions(query: string): Command[] {
		return matchCommands(listCommands(this.app), query);
	}

	renderSuggestion(command: Command, el: HTMLElement): void {
		// The id under the name disambiguates the several plugins that ship a
		// command called "Insert table" or "Toggle", and it is the only thing
		// on screen that says which plugin a row came from.
		el.createDiv({ cls: "ftn-command-suggest-name", text: command.name });
		el.createDiv({ cls: "ftn-command-suggest-id", text: command.id });
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
	private labelInputEl: HTMLInputElement | null = null;

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
			.addText((text) => {
				this.labelInputEl = text.inputEl;
				text.setValue(this.label)
					.onChange((value) => {
						this.label = value;
					});
			});

		const commandName = listCommands(this.app)
			.find((command) => command.id === this.commandId)?.name ?? "";

		new Setting(contentEl)
			.setName(t("settings.customCommand.command"))
			.setDesc(t("settings.customCommand.commandDesc"))
			.addText((text) => {
				text.setValue(commandName);
				new CommandSuggest(this.app, text.inputEl, (command) => {
					this.commandId = command.id;
					// Save refuses a row with no label, so leaving the name
					// blank made the button look broken. The command's own name
					// is what the user picked it by, and they can still edit it.
					if (!this.label.trim() && this.labelInputEl) {
						this.label = command.name;
						this.labelInputEl.value = command.name;
					}
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
