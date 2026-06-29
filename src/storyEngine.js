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
    get index()   { return this._index; }
    get length()  { return this._steps.length; }
    get steps()   { return this._steps; }

    set onGoto(fn) { this._onGoto = fn; }

    start()    { this._goto(0); }
    next()     { this._goto(this._index + 1); }
    goto(i)    { this._goto(i); }
    stop()     {
        if (this._index < 0) return;
        this.current?.exit?.(this._sim);
        this._index = -1;
        this._onGoto?.(-1);
    }

    _goto(i) {
        if (i < 0 || i >= this._steps.length) return;
        this.current?.exit?.(this._sim);
        this._index = i;
        this.current?.enter?.(this._sim);
        this._onGoto?.(i);
    }

    onSpectatorJoined(userCount) {
        this.current?.onSpectatorJoined?.(this._sim, userCount);
    }

    onNote(noteIndex) {
        this.current?.onNote?.(this._sim, noteIndex);
    }
}
