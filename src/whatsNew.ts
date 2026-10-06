/**
 * The "What's new" card shown once after an update.
 *
 * Plain data plus one decision, so when the card appears is testable without
 * Obsidian. The modal itself lives in whatsNewModal.ts.
 * See test/whatsNew.test.mjs.
 */

export interface ReleaseNotes {
	version: string;
	items: string[];
}

/**
 * What this release changed, in user terms.
 *
 * Bump `version` together with manifest.json. A mismatch shows nothing rather
 * than an older release's notes under a newer version number.
 */
export const RELEASE_NOTES: ReleaseNotes = {
	version: "0.7.0",
	items: [
		"Bullet depth markers are built in. Child bullets get their own marker in the file, - then * then +, and a matching ● ○ ▪ on screen. Off by default: turn it on under Settings → Feel the Notion → Bullet depth markers.",
		"The marker sequence can be reordered by dragging, and any marker switched off.",
		"This card. It shows once per update and can be reopened from the command palette with \"Show what's new\".",
	],
};

/**
 * Whether to open the card on load.
 *
 * Only on an update: `hadSavedData` is false on a fresh install, where
 * nothing is "new". Everyone already on the plugin has a data.json, including
 * users from before this field existed, so a missing `lastSeen` with saved
 * data still counts as an update.
 */
export function shouldShowWhatsNew(
	hadSavedData: boolean,
	lastSeen: string | undefined,
	current: string,
	notesVersion: string
): boolean {
	return hadSavedData && lastSeen !== current && notesVersion === current;
}
