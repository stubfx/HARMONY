// ── Magenta MusicVAE — ML-generated melody layer ─────────────────────────────
// MusicVAE samples 4-bar melodies from a latent space learned on MIDI.
// chaos drives sampling temperature: low chaos → structured melodies;
//                                    high chaos → unpredictable variation.
// The layer appears below chaos 0.35, mirroring the arp it replaces in synth.js.

import * as mm from '@magenta/music';
import * as Tone from 'tone';

const CHECKPOINT = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_4bar_med_q2';
const STEPS_PER_QUARTER = 4; // standard Magenta quantization (1 step = 1 sixteenth note)

let _vae      = null;
let _synth    = null;
let _vol      = null;
let _part     = null;
let _ready    = false;
let _lastChaos = -1;
let _resampling = false;

function _midiToNote(midi) {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

// Convert Magenta quantized step → Tone.js Transport time string 'B:b:s'
function _stepToTime(step) {
    const s16 = step; // 1 step = 1 sixteenth note (stepsPerQuarter=4)
    return `${Math.floor(s16 / 16)}:${Math.floor((s16 % 16) / 4)}:${s16 % 4}`;
}

export async function initMagentaSynth() {
    if (_ready) return;
    try {
        _vae = new mm.MusicVAE(CHECKPOINT);
        await _vae.initialize();

        _vol = new Tone.Volume(-60);

        _synth = new Tone.Synth({
            oscillator: { type: 'triangle8' },
            envelope:   { attack: 0.03, decay: 0.15, sustain: 0.35, release: 1.2 },
            volume:     -4,
        });
        _synth.connect(_vol);
        _vol.toDestination();

        _ready = true;
        console.log('[magenta] initialized');
        _resample(1.0);
    } catch (e) {
        console.warn('[magenta] init failed — melody layer disabled:', e);
    }
}

function _resample(chaos) {
    if (!_vae || !_ready || _resampling) return;
    _resampling = true;
    const temp = 0.3 + chaos * 1.4; // 0.3 at harmony → 1.7 at chaos
    _vae.sample(1, temp).then(([seq]) => {
        _schedulePart(seq);
        _lastChaos = chaos;
        console.log(`[magenta] resampled  chaos=${chaos.toFixed(2)}  temp=${temp.toFixed(2)}  notes=${seq.notes?.length ?? 0}`);
    }).catch(e => {
        console.warn('[magenta] sample error:', e);
    }).finally(() => {
        _resampling = false;
    });
}

function _schedulePart(seq) {
    _part?.stop();
    _part?.dispose();

    const events = (seq.notes ?? []).map(n => ({
        time: _stepToTime(n.quantizedStartStep),
        note: _midiToNote(n.pitch),
        vel:  (n.velocity ?? 80) / 127,
    }));

    let _dbg = 0;
    _part = new Tone.Part((t, ev) => {
        if (_dbg++ < 4) console.log('[magenta] NOTE', ev.note, 'vel', ev.vel?.toFixed(2), 'vol', _vol?.volume.value.toFixed(1) + 'dB');
        _synth.triggerAttackRelease(ev.note, '16n', t, ev.vel);
    }, events);

    _part.loop    = true;
    _part.loopEnd = '4m'; // mel_4bar = always 4 bars
    _part.start('+0.1');
}

// chaos     : 0 = harmony, 1 = chaos
// coherence : unused here but reserved for future filter modulation
// temp      : unused here (BPM already driven by Transport via setSynthState)
export function setMagentaState(chaos, _coherence = 0.5, _temp = 0.5) {
    if (!_ready) return;
    const c = Math.max(0, Math.min(1, chaos));

    // Melody audible below chaos 0.6, same threshold as the pad layer
    const gain = c < 0.6 ? Math.pow(1 - c / 0.6, 1.5) * 0.45 : 0;
    const db   = gain > 0 ? Math.max(-60, Tone.gainToDb(gain)) : -60;
    _vol.volume.value = db;

    // Re-sample when chaos crosses a significant threshold
    if (!_resampling && Math.abs(c - _lastChaos) > 0.15) {
        _resample(c);
    }
}

export function stopMagentaSynth() {
    if (!_ready) return;
    _part?.stop();
    _vol?.volume.setTargetAtTime(-60, Tone.now(), 0.5);
}
