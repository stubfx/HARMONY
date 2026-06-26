// ─── Story Engine ────────────────────────────────────────────────────────────
// Drives the story defined in story.js. Each step receives a sim facade and
// can react to sim events. Call start() to begin from step 0.

export class StoryEngine {
    constructor(steps, sim) {
        this._steps = steps;
        this._sim   = sim;
        this._index = -1;
    }

    get current() { return this._steps[this._index] ?? null; }
    get stepId()  { return this.current?.id ?? null; }

    start() { this._goto(0); }
    next()  { this._goto(this._index + 1); }

    _goto(i) {
        if (i < 0 || i >= this._steps.length) return;
        this.current?.exit?.(this._sim);
        this._index = i;
        this.current?.enter?.(this._sim);
    }

    onSpectatorJoined(userCount) {
        this.current?.onSpectatorJoined?.(this._sim, userCount);
    }
}
