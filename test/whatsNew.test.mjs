/**
 * When the "What's new" card appears.
 *
 * It belongs to an update, so a fresh install never sees it, and nobody sees
 * the same release's card twice.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowWhatsNew } from "./.build/whatsNew.js";

test("an update to a version with notes shows the card", () => {
	assert.equal(shouldShowWhatsNew(true, "0.6.3", "0.7.0", "0.7.0"), true);
});

test("a user who never recorded a version but has settings is updating", () => {
	// Everyone on 0.6.3 or earlier: data.json exists, the field does not yet.
	assert.equal(shouldShowWhatsNew(true, undefined, "0.7.0", "0.7.0"), true);
});

test("a fresh install shows nothing", () => {
	assert.equal(shouldShowWhatsNew(false, undefined, "0.7.0", "0.7.0"), false);
});

test("a dismissed card stays dismissed", () => {
	assert.equal(shouldShowWhatsNew(true, "0.7.0", "0.7.0", "0.7.0"), false);
});

test("a release with no notes of its own shows nothing", () => {
	// Notes for 0.7.0 must not appear on a 0.7.1 that forgot to write any.
	assert.equal(shouldShowWhatsNew(true, "0.7.0", "0.7.1", "0.7.0"), false);
});
