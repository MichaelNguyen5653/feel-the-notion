import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameScheduler } from "./.build/frameScheduler.js";

/**
 * A stand-in for the browser's frame loop, so the coalescing can be tested
 * without a DOM. `flush` plays the part of the browser reaching a paint.
 */
function fakeWindow() {
	let nextId = 1;
	const queued = new Map();
	return {
		requestAnimationFrame(cb) {
			const id = nextId++;
			queued.set(id, cb);
			return id;
		},
		cancelAnimationFrame(id) {
			queued.delete(id);
		},
		/** Runs every callback the browser would have run at the next paint. */
		flush() {
			const due = [...queued.values()];
			queued.clear();
			for (const cb of due) cb();
		},
		get pending() {
			return queued.size;
		},
	};
}

test("a burst of tasks runs once, not once per task", () => {
	const win = fakeWindow();
	const scheduler = new FrameScheduler(win);
	let runs = 0;

	for (let i = 0; i < 50; i++) scheduler.schedule(() => runs++);
	assert.equal(runs, 0, "nothing runs before the frame");
	assert.equal(win.pending, 1, "50 schedules must not queue 50 frames");

	win.flush();
	assert.equal(runs, 1);
});

test("the newest task wins — stale positions are never replayed", () => {
	const win = fakeWindow();
	const scheduler = new FrameScheduler(win);
	const seen = [];

	// Each closure stands for one pointer position. Running an older one would
	// move the handle somewhere the pointer has already left.
	scheduler.schedule(() => seen.push("stale"));
	scheduler.schedule(() => seen.push("older"));
	scheduler.schedule(() => seen.push("newest"));

	win.flush();
	assert.deepEqual(seen, ["newest"]);
});

test("a later burst schedules a fresh frame", () => {
	const win = fakeWindow();
	const scheduler = new FrameScheduler(win);
	let runs = 0;

	scheduler.schedule(() => runs++);
	win.flush();
	scheduler.schedule(() => runs++);
	win.flush();

	assert.equal(runs, 2, "the scheduler must not latch after its first frame");
});

test("cancel drops the pending task", () => {
	const win = fakeWindow();
	const scheduler = new FrameScheduler(win);
	let runs = 0;

	scheduler.schedule(() => runs++);
	scheduler.cancel();
	win.flush();

	assert.equal(runs, 0, "a cancelled frame must not touch a torn-down view");
	assert.equal(win.pending, 0, "cancel must release the frame too");
});

test("scheduling still works after a cancel", () => {
	const win = fakeWindow();
	const scheduler = new FrameScheduler(win);
	let runs = 0;

	scheduler.schedule(() => runs++);
	scheduler.cancel();
	scheduler.schedule(() => runs++);
	win.flush();

	// stopDrag cancels and a fresh drag schedules again; if cancel left the
	// internal frame id set, the next drag would never paint.
	assert.equal(runs, 1);
});

test("cancel is safe with nothing pending", () => {
	const win = fakeWindow();
	const scheduler = new FrameScheduler(win);
	assert.doesNotThrow(() => scheduler.cancel());
});
