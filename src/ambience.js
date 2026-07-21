// ambience.js — ambient blinkers engine
// Audio track playback has been removed; this module now only manages the blinker loop.
// start()/stop() are kept as stubs (called by simFacade) but do nothing meaningful.

import { blinker, BLINKER_TYPES } from './synth.js';

let _started = false;

export function init(_apiBase) {}

export function start() { _started = true; }
export function stop()  { _started = false; }

// ── Blinkers loop ─────────────────────────────────────────────────────────────
// Plays a random blinker every 0.2–8 s. Fully async, cancellable.
// onBlink() is called synchronously after each blinker fires.

let _blinkersTimer = null;
let _onBlink       = null;

function _blinkersStep() {
    const delay = 200 + Math.random() * 7800;
    _blinkersTimer = setTimeout(() => {
        const type = BLINKER_TYPES[Math.floor(Math.random() * BLINKER_TYPES.length)];
        blinker(type);
        _onBlink?.();
        _blinkersStep();
    }, delay);
}

export function startBlinkersLoop(onBlink) {
    if (_blinkersTimer !== null) return;
    _onBlink = onBlink ?? null;
    _blinkersStep();
}

export function stopBlinkersLoop() {
    if (_blinkersTimer === null) return;
    clearTimeout(_blinkersTimer);
    _blinkersTimer = null;
}

// Fires `count` blinkers in rapid succession, spaced `intervalMs` apart.
export function burstBlinkers(count = 4, intervalMs = 150) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const type = BLINKER_TYPES[Math.floor(Math.random() * BLINKER_TYPES.length)];
            blinker(type);
        }, i * intervalMs);
    }
}
