/**
 * Collapses a burst of events into one callback per animation frame.
 *
 * WHY THIS EXISTS
 * A mouse reports movement far faster than the screen redraws — 125 events a
 * second on an ordinary mouse, over 1000 on a gaming one, against 60 frames.
 * Handlers wired straight to `mousemove` therefore do the same measuring and
 * positioning work several times between two paints, and every repeat past the
 * first is thrown away unseen.
 *
 * Scheduling through here keeps only the most recent task and runs it once,
 * just before the browser paints. Work per second stops tracking the pointer's
 * report rate and starts tracking the refresh rate.
 *
 * WHY THE LATEST TASK WINS
 * Each task is a closure over one event's coordinates. Older ones describe
 * positions the pointer has already left, so running them would move the
 * handle to somewhere it no longer belongs before correcting it. Replacing
 * rather than queueing is what makes this a coalescer instead of a buffer.
 */
export class FrameScheduler {
	private frame: number | null = null;
	private pending: (() => void) | null = null;

	constructor(private win: Window) {}

	/** Runs `task` at the next paint, replacing any task not yet run. */
	schedule(task: () => void): void {
		this.pending = task;
		if (this.frame !== null) return;

		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = null;
			const task = this.pending;
			this.pending = null;
			task?.();
		});
	}

	/**
	 * Drops any pending task and cancels the frame.
	 *
	 * Callers must do this on teardown: a queued callback closes over the view,
	 * so letting it fire after destroy() would touch a detached editor.
	 */
	cancel(): void {
		if (this.frame !== null) {
			this.win.cancelAnimationFrame(this.frame);
			this.frame = null;
		}
		this.pending = null;
	}
}
