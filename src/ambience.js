// ambience.js — self-contained ambient music engine
// Tone.js radio chain + simAss audio fetch/chaining.
// Call init(apiBase) once at startup, then start() when the story is ready.

import * as Tone from 'tone';
import { blinker, BLINKER_TYPES } from './synth.js';

let _apiBase = '';
let _started = false;
let _gen     = 0; // increment to cancel stale fetch callbacks

// ── Tone.js signal chain ──────────────────────────────────────────────────────
let _chainReady = false;
let _player     = null;
let _filter     = null;
let _dist       = null;
let _tremolo    = null;
let _reverb     = null;
let _vol        = null;
let _fadeGain   = null;
let _noiseGain  = null;
let _busVol     = null;

async function _buildChain() {
    if (_chainReady) return;
    _filter   = new Tone.Filter({ frequency: 4000, type: 'lowpass', rolloff: -24 });
    _dist     = new Tone.Distortion(0);
    _tremolo  = new Tone.Tremolo({ frequency: 3, depth: 0 }).start();
    _reverb   = new Tone.Reverb({ decay: 4, wet: 0.15 });
    _vol      = new Tone.Volume(-3);
    _fadeGain = new Tone.Gain(0); // starts silent — fade in on start()
    _busVol   = new Tone.Volume(0);
    _player   = new Tone.Player({ loop: false, fadeOut: 0.1 });

    _player.chain(_filter, _dist, _tremolo, _reverb, _vol, _fadeGain);
    _fadeGain.connect(_busVol);

    const noiseBP  = new Tone.Filter({ frequency: 2000, type: 'bandpass', Q: 1.0 });
    _noiseGain     = new Tone.Gain(0);
    const noise    = new Tone.Noise('white');
    noise.connect(noiseBP);
    noiseBP.connect(_noiseGain);
    _noiseGain.connect(_fadeGain);

    _busVol.toDestination();
    noise.start();

    await _reverb.ready;
    _chainReady = true;
}

// Exponential time constant for fade in/out (seconds).
const FADE_TC = 2.5;

// ── Track fetch → play → loop ─────────────────────────────────────────────────

async function _fetchAndPlay(gen, fadeIn) {
    if (gen !== _gen) return;
    try {
        const res = await fetch(`${_apiBase}/simAss-audio`);
        if (!res.ok) { console.warn('[ambience] HTTP', res.status); return; }
        if (gen !== _gen) return;
        const buf = await res.arrayBuffer();
        if (gen !== _gen) return;

        await Tone.start();
        await _buildChain();
        if (gen !== _gen) return;

        if (_player.state === 'started') _player.stop();
        const blob = new Blob([buf], { type: 'audio/mpeg' });
        const url  = URL.createObjectURL(blob);
        await _player.load(url);
        URL.revokeObjectURL(url);

        _player.onstop = () => _fetchAndPlay(gen, false); // chain next track

        if (fadeIn) {
            const t  = Tone.now();
            const TC = FADE_TC;
            _fadeGain.gain.cancelScheduledValues(t);
            _fadeGain.gain.setValueAtTime(0, t);
            _fadeGain.gain.setTargetAtTime(1, t, TC);
        }
        _player.start();
        console.log(`[ambience] playing (${buf.byteLength}B)${fadeIn ? ' fade-in' : ''}`);
    } catch (e) {
        console.warn('[ambience]', e);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function init(apiBase) {
    _apiBase = apiBase;
}

// Enable and begin playing. Safe to call multiple times — no-op if already started.
export function start() {
    if (_started) return;
    _started = true;
    _fetchAndPlay(++_gen, true);
}

// Fade out and stop.
export function stop() {
    _started = false;
    ++_gen; // cancel any in-flight fetch
    if (!_chainReady) return;
    const t  = Tone.now();
    const TC = FADE_TC;
    _fadeGain.gain.cancelScheduledValues(t);
    _fadeGain.gain.setTargetAtTime(0, t, TC);
    setTimeout(() => { if (_player?.state === 'started') _player.stop(); }, TC * 3.5 * 1000);
}

// Independent bus volume (dB). Matches the GUI ch2 slider.
export function setVolume(db) {
    if (_busVol) _busVol.volume.value = db;
}

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
